const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CALIBRATION_VERSION = 1;
const PROFILE_KEYS = new Set(['layoutPreset', 'framing', 'captionOptions', 'protectedRegions', 'verification']);

function emptyDocument() {
  return { version: CALIBRATION_VERSION, profiles: {} };
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`take-a-repo: ${name} must be a non-empty string`);
  return value.trim();
}

function finiteNumber(value, name, { min = -Infinity, max = Infinity, exclusiveMin = false } = {}) {
  if (!Number.isFinite(value) || (exclusiveMin ? value <= min : value < min) || value > max) {
    const boundary = exclusiveMin ? `greater than ${min}` : `between ${min} and ${max}`;
    throw new Error(`take-a-repo: ${name} must be a finite number ${boundary}`);
  }
  return value;
}

function normalizeRegion(region, index) {
  if (!isObject(region)) throw new Error(`take-a-repo: protectedRegions[${index}] must be an object`);
  const id = nonEmptyString(region.id, `protectedRegions[${index}].id`);
  const normalized = {
    id,
    ...(region.label == null ? {} : { label: nonEmptyString(region.label, `protectedRegions[${index}].label`) }),
    x: finiteNumber(region.x, `protectedRegions[${index}].x`, { min: 0 }),
    y: finiteNumber(region.y, `protectedRegions[${index}].y`, { min: 0 }),
    width: finiteNumber(region.width, `protectedRegions[${index}].width`, { min: 0, exclusiveMin: true }),
    height: finiteNumber(region.height, `protectedRegions[${index}].height`, { min: 0, exclusiveMin: true }),
  };
  return normalized;
}

function normalizeProfile(profile, name = 'calibration profile') {
  if (!isObject(profile)) throw new Error(`take-a-repo: ${name} must be an object`);
  const unknown = Object.keys(profile).filter((key) => !PROFILE_KEYS.has(key));
  if (unknown.length) throw new Error(`take-a-repo: ${name} has unknown field(s): ${unknown.join(', ')}`);
  const normalized = {};
  if (profile.layoutPreset != null) normalized.layoutPreset = nonEmptyString(profile.layoutPreset, `${name}.layoutPreset`);
  if (profile.framing != null) {
    if (!isObject(profile.framing)) throw new Error(`take-a-repo: ${name}.framing must be an object`);
    normalized.framing = {
      scale: finiteNumber(profile.framing.scale, `${name}.framing.scale`, { min: 1, max: 1.2 }),
      focusX: finiteNumber(profile.framing.focusX, `${name}.framing.focusX`, { min: 0, max: 1 }),
      focusY: finiteNumber(profile.framing.focusY, `${name}.framing.focusY`, { min: 0, max: 1 }),
    };
  }
  if (profile.captionOptions != null) {
    if (!isObject(profile.captionOptions)) throw new Error(`take-a-repo: ${name}.captionOptions must be an object`);
    const captionOptions = {};
    if (profile.captionOptions.position != null) {
      if (!['bottom-left', 'bottom'].includes(profile.captionOptions.position)) {
        throw new Error(`take-a-repo: ${name}.captionOptions.position must be "bottom-left" or "bottom"`);
      }
      captionOptions.position = profile.captionOptions.position;
    }
    if (profile.captionOptions.appearance != null) {
      if (!['panel', 'outline'].includes(profile.captionOptions.appearance)) {
        throw new Error(`take-a-repo: ${name}.captionOptions.appearance must be "panel" or "outline"`);
      }
      captionOptions.appearance = profile.captionOptions.appearance;
    }
    if (profile.captionOptions.bottomOffset != null) {
      if (!Number.isInteger(profile.captionOptions.bottomOffset) || profile.captionOptions.bottomOffset < 0) {
        throw new Error(`take-a-repo: ${name}.captionOptions.bottomOffset must be a non-negative integer`);
      }
      captionOptions.bottomOffset = profile.captionOptions.bottomOffset;
    }
    const unknownCaption = Object.keys(profile.captionOptions)
      .filter((key) => !['position', 'appearance', 'bottomOffset'].includes(key));
    if (unknownCaption.length) {
      throw new Error(`take-a-repo: ${name}.captionOptions has unknown field(s): ${unknownCaption.join(', ')}`);
    }
    normalized.captionOptions = captionOptions;
  }
  const regions = profile.protectedRegions == null ? [] : profile.protectedRegions;
  if (!Array.isArray(regions) || regions.length > 3) {
    throw new Error(`take-a-repo: ${name}.protectedRegions must be an array with at most 3 entries`);
  }
  normalized.protectedRegions = regions.map(normalizeRegion);
  const ids = normalized.protectedRegions.map((region) => region.id);
  if (new Set(ids).size !== ids.length) throw new Error(`take-a-repo: ${name}.protectedRegions ids must be unique`);
  if (profile.verification != null) {
    if (!isObject(profile.verification)) throw new Error(`take-a-repo: ${name}.verification must be an object`);
    if (profile.verification.status !== 'publish-ready') {
      throw new Error(`take-a-repo: ${name}.verification.status must be "publish-ready"`);
    }
    const verifiedAt = nonEmptyString(profile.verification.verifiedAt, `${name}.verification.verifiedAt`);
    if (Number.isNaN(Date.parse(verifiedAt))) {
      throw new Error(`take-a-repo: ${name}.verification.verifiedAt must be an ISO date-time`);
    }
    normalized.verification = {
      profileHash: nonEmptyString(profile.verification.profileHash, `${name}.verification.profileHash`),
      status: profile.verification.status,
      verifiedAt,
    };
  }
  return normalized;
}

function assertVerification(profile, name) {
  if (profile.verification && profile.verification.profileHash !== calibrationProfileHash(profile)) {
    throw new Error(`take-a-repo: ${name}.verification.profileHash does not match the current profile`);
  }
}

function assertLayoutPresets(document, layouts) {
  if (!layouts.length) return;
  for (const [story, targets] of Object.entries(document.profiles)) {
    for (const [target, profile] of Object.entries(targets)) {
      if (profile.layoutPreset && !layouts.includes(profile.layoutPreset)) {
        throw new Error(
          `take-a-repo: calibration profiles.${story}.${target}.layoutPreset must be one of: ${layouts.join(', ')}`,
        );
      }
    }
  }
}

function normalizeDocument(document) {
  if (!isObject(document)) throw new Error('take-a-repo: calibration document must be an object');
  if (document.version !== CALIBRATION_VERSION) {
    throw new Error(`take-a-repo: calibration version must be ${CALIBRATION_VERSION}`);
  }
  if (!isObject(document.profiles)) throw new Error('take-a-repo: calibration profiles must be an object');
  const profiles = {};
  for (const [story, targets] of Object.entries(document.profiles)) {
    nonEmptyString(story, 'calibration story key');
    if (!isObject(targets)) throw new Error(`take-a-repo: calibration profiles.${story} must be an object`);
    profiles[story] = {};
    for (const [target, profile] of Object.entries(targets)) {
      nonEmptyString(target, `calibration profiles.${story} target key`);
      const name = `calibration profiles.${story}.${target}`;
      profiles[story][target] = normalizeProfile(profile, name);
      assertVerification(profiles[story][target], name);
    }
  }
  return { version: CALIBRATION_VERSION, profiles };
}

function calibrationSpec(config, cwd) {
  if (config.calibration == null || config.calibration === false) return { path: null, layouts: [] };
  if (!isObject(config.calibration)) throw new Error('take-a-repo: config.calibration must be false or an object');
  const from = nonEmptyString(config.calibration.from, 'config.calibration.from');
  const root = path.resolve(cwd);
  const filePath = path.resolve(root, from);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('take-a-repo: config.calibration.from must stay inside the project directory');
  }
  const layouts = config.calibration.layouts == null ? [] : config.calibration.layouts;
  if (!Array.isArray(layouts) || layouts.some((layout) => typeof layout !== 'string' || !layout.trim())) {
    throw new Error('take-a-repo: config.calibration.layouts must be a string array');
  }
  return { path: filePath, layouts: [...new Set(layouts.map((layout) => layout.trim()))] };
}

function loadCalibration(config, cwd) {
  const spec = calibrationSpec(config, cwd);
  if (!spec.path || !fs.existsSync(spec.path)) return { ...spec, document: emptyDocument() };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(spec.path, 'utf8'));
  } catch (error) {
    throw new Error(`take-a-repo: could not parse calibration file: ${error.message}`, { cause: error });
  }
  const document = normalizeDocument(parsed);
  assertLayoutPresets(document, spec.layouts);
  return { ...spec, document };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function calibrationProfileHash(profile) {
  const normalized = normalizeProfile(profile);
  delete normalized.verification;
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(normalized))).digest('hex');
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function updateCalibrationProfile(config, cwd, story, target, profile) {
  story = nonEmptyString(story, 'calibration story');
  target = nonEmptyString(target, 'calibration target');
  const loaded = loadCalibration(config, cwd);
  if (!loaded.path) throw new Error('take-a-repo: config.calibration.from is required before saving a profile');
  const normalizedProfile = normalizeProfile(profile);
  assertVerification(normalizedProfile, 'calibration profile');
  if (normalizedProfile.layoutPreset && loaded.layouts.length && !loaded.layouts.includes(normalizedProfile.layoutPreset)) {
    throw new Error(`take-a-repo: calibration profile.layoutPreset must be one of: ${loaded.layouts.join(', ')}`);
  }
  const document = loaded.document;
  if (!document.profiles[story]) document.profiles[story] = {};
  document.profiles[story][target] = normalizedProfile;
  atomicWrite(loaded.path, `${JSON.stringify(document, null, 2)}\n`);
  return { path: loaded.path, document, profile: normalizedProfile };
}

function profileFor(document, demo) {
  const story = demo.story || demo.name;
  return document.profiles && document.profiles[story] && demo.target
    ? document.profiles[story][demo.target]
    : null;
}

function framingZoom(framing) {
  if (!framing || framing.scale <= 1) return null;
  const scale = framing.scale;
  return {
    scale,
    x: `(iw-iw/${scale})*${framing.focusX}`,
    y: `(ih-ih/${scale})*${framing.focusY}`,
  };
}

function applyCalibrationProfiles(demos, document = emptyDocument()) {
  const normalized = normalizeDocument(document);
  return demos.map((demo) => {
    const profile = profileFor(normalized, demo);
    if (!profile) return demo;
    const zoom = framingZoom(profile.framing);
    const calibrationProfile = {
      ...profile,
      profileHash: calibrationProfileHash(profile),
    };
    return {
      ...demo,
      ...(zoom ? { zoom } : {}),
      captionOptions: { ...(demo.captionOptions || {}), ...(profile.captionOptions || {}) },
      calibrationProfile,
    };
  });
}

module.exports = {
  CALIBRATION_VERSION,
  applyCalibrationProfiles,
  calibrationProfileHash,
  calibrationSpec,
  emptyDocument,
  loadCalibration,
  normalizeDocument,
  normalizeProfile,
  updateCalibrationProfile,
};
