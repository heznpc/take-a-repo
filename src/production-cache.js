const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { digest } = require('./evidence-contract');
const { fingerprintInputs } = require('./evidence-inputs');
const { readJsonIfExists, safeAssetPath, sha256File } = require('./handoff-files');

function stableJson(value) {
  if (typeof value === 'function') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function engineFiles(stage) {
  if (stage === 'render') return ['src', 'schemas', 'package.json'];
  // Follow the collector's actual local dependencies. The capture() evidence
  // dispatch is unreachable for a browser producer (nested evidence is rejected).
  const root = path.resolve(__dirname, '..');
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    if (!file.endsWith('.js')) return;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const dependency = require.resolve(path.resolve(path.dirname(file), match[1]));
      if (dependency === path.join(__dirname, 'evidence-runner.js')) continue;
      if (stage === 'command' && dependency === path.join(__dirname, 'capture.js')) continue;
      visit(dependency);
    }
  }
  visit(path.join(__dirname, 'evidence-producer.js'));
  visit(path.join(__dirname, 'evidence-inputs.js'));
  return [...visited].map((file) => path.relative(root, file)).sort();
}

function runtimeFingerprint() {
  const dependencies = Object.keys(require('../package.json').dependencies).map((name) => {
    let directory = path.dirname(require.resolve(name));
    while (true) {
      const manifest = readJsonIfExists(path.join(directory, 'package.json'));
      if (manifest?.name === name) return [name, manifest.version];
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`cannot fingerprint dependency ${name}`);
      directory = parent;
    }
  });
  const mediaTools = [...new Set([process.env.TAKE_A_REPO_FFMPEG, process.env.TAKE_A_REPO_FFPROBE, 'ffmpeg', 'ffprobe'].filter(Boolean))].map((bin) => {
    const result = spawnSync(bin, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
    return [bin, result.status === 0 ? digest(result.stdout) : 'unavailable'];
  });
  return {
    node: process.version, platform: process.platform, arch: process.arch, os: os.release(),
    dependencies, mediaTools,
  };
}

function engineFingerprint(stage = 'render', runtime = runtimeFingerprint()) {
  return digest(stableJson({ ...runtime, files: fingerprintInputs(path.resolve(__dirname, '..'), engineFiles(stage)).digest }));
}

function engineFingerprints() {
  const runtime = runtimeFingerprint();
  return Object.fromEntries(['render', 'command', 'browser'].map((stage) => [stage, engineFingerprint(stage, runtime)]));
}

function reusableRun(report) {
  if (!report?.scope?.full) return false;
  if (report.machineStatus === 'publish-ready') return true;
  // Rendering cannot invalidate verified footage. All execution, integrity and
  // freshness checks must have completed; this grants no publication authority.
  return report.production?.captureVerified === true
    && ['needs-fix', 'blocked'].includes(report.machineStatus);
}

function validatedRun(outDir, pointer) {
  if (!pointer || pointer.state !== 'completed') return null;
  const file = safeAssetPath(outDir, { outPath: pointer.run });
  try {
    if (!file || sha256File(file) !== pointer.sha256) return null;
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (report.id !== pointer.id || report.kind !== 'take-a-repo.evidence-run'
      || !reusableRun(report)) return null;
    const runDir = path.dirname(file);
    return { report, runDir, manifest: file, reportHash: pointer.sha256 };
  } catch (_error) { return null; }
}

function previousRun(outDir) {
  // A failed render, including the first run, can retain verified footage. This cache
  // pointer is never an approval pointer and every referenced byte is rehashed.
  const marker = readJsonIfExists(path.join(outDir, '.take-a-repo-run.json'));
  return (marker?.status === 'completed' && validatedRun(outDir, readJsonIfExists(path.join(outDir, 'take-a-repo-evidence.json'))))
    || validatedRun(outDir, readJsonIfExists(path.join(outDir, 'take-a-repo-production-cache.json')))
    || null;
}

function inputState(config, cwd, engine) {
  const spec = config.evidence;
  const common = spec.inputs ? fingerprintInputs(cwd, spec.inputs).digest : null;
  const producers = spec.producers.map((producer) => {
    const reuse = producer.reuse;
    if (!reuse) return { id: producer.id, key: null, reason: 'producer has no local-input reuse contract' };
    if (producer.import) throw new Error('imported evidence cannot opt into executed-evidence reuse');
    if (!reuse || reuse.mode !== 'local-inputs' || !Array.isArray(reuse.inputs) || !reuse.inputs.length
      || !Number.isInteger(reuse.maxAgeSeconds) || reuse.maxAgeSeconds < 1 || reuse.maxAgeSeconds > 604800
      || reuse.environment != null && (!Array.isArray(reuse.environment) || reuse.environment.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)))) {
      throw new Error(`${producer.id}: reuse requires mode local-inputs, inputs, maxAgeSeconds (1..604800), and optional environment names`);
    }
    // Environment values are hashed, never put into reports or model context.
    const environment = Object.fromEntries((reuse.environment || []).map((key) => [key, process.env[key] ?? null]));
    const collector = typeof engine === 'string' ? engine : engine[producer.capture ? 'browser' : 'command'];
    const key = digest(stableJson({ engine: collector, common, producer, environment, inputs: fingerprintInputs(cwd, reuse.inputs).digest }));
    return { id: producer.id, key, maxAgeSeconds: reuse.maxAgeSeconds };
  });
  const buildKey = spec.inputs && spec.buildOutputs
    ? digest(stableJson({ engine, common, build: config.build || null, producers: producers.map((p) => p.key) })) : null;
  return { common, producers, buildKey, digest: digest(stableJson({ common, producers, buildKey })) };
}

function buildState(config, cwd) {
  return config.evidence.buildOutputs ? fingerprintInputs(cwd, config.evidence.buildOutputs).digest : null;
}

function producerKey(input, build, command) {
  return input.key && digest(stableJson({ input: input.key, build, command: command || null }));
}

function reusableProducer(previous, producer, input, key, now = Date.now()) {
  const old = previous?.report.producers.find((item) => item.id === producer.id);
  const capturedAt = Date.parse(old?.origin?.finishedAt || old?.finishedAt);
  return !!(key && old?.reuseKey === key && ['executed', 'reused'].includes(old.mode)
    && old.status === 'collected' && old.checks.length && old.checks.every((check) => check.status === 'pass')
    && Number.isFinite(capturedAt) && now >= capturedAt && now - capturedAt <= input.maxAgeSeconds * 1000
    && artifactsIntact(previous, old.assets));
}

function artifactsIntact(previous, assets) {
  if (!previous || !assets?.length || assets.some((asset) => !asset)) return false;
  try {
    return assets.every((asset) => {
      const file = safeAssetPath(previous.runDir, { outPath: asset.path });
      return file && sha256File(file) === asset.sha256;
    });
  } catch (_error) { return false; }
}

function reusableDelivery(previous, delivery) {
  return !!delivery && artifactsIntact(previous, delivery.files.map((file) => previous.report.files.find((asset) => asset.path === file)));
}

function renderKey(spec, report, engine, renderInputs = null) {
  const producers = spec.kind === 'video'
    ? report.producers.filter((p) => p.id === spec.source.split(':')[0]) : report.producers;
  return digest(stableJson({ engine, renderInputs, spec, producers: producers.map((p) => ({
    id: p.id, origin: p.origin || { runId: report.id }, checks: p.checks.map(({ verification: _verification, ...check }) => check),
    assets: p.assets.map((a) => ({ id: a.id, sha256: a.sha256, captionState: a.captionState || 'unknown' })),
  })), claims: report.claims.filter((c) => spec.claims.includes(c.id)) }));
}

function copyArtifacts(previous, runDir, assets) {
  for (const asset of assets) {
    const source = safeAssetPath(previous.runDir, { outPath: asset.path });
    const target = safeAssetPath(runDir, { outPath: asset.path });
    if (!source || !target || sha256File(source) !== asset.sha256) throw new Error(`cached asset changed: ${asset.path}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    if (sha256File(target) !== asset.sha256) throw new Error(`cached copy changed: ${asset.path}`);
  }
}

function reuseProducer(previous, runDir, producer) {
  const old = previous.report.producers.find((p) => p.id === producer.id);
  copyArtifacts(previous, runDir, old.assets);
  return {
    ...old, mode: 'reused', reusedFrom: { runId: previous.report.id, reportHash: previous.reportHash },
    origin: old.origin || { runId: previous.report.id, source: previous.report.source, finishedAt: old.finishedAt },
    checks: old.checks.map((check) => ({ ...check, verification: 'reused-producer-asserted' })),
  };
}

module.exports = { stableJson, engineFingerprint, engineFingerprints, engineFiles, artifactsIntact, reusableDelivery, reusableRun, previousRun, inputState, buildState, producerKey, reusableProducer, renderKey, copyArtifacts, reuseProducer };
