const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { digest, validateEvidenceConfig } = require('./evidence-contract');
const { readJsonIfExists, safeAssetPath, sha256File, writeJson } = require('./handoff-files');
const { previousRun, stableJson } = require('./production-cache');
const { readProject, applyProject, withProjectLock } = require('./production-project');
const { observationTool, extractObservationFrames } = require('./production-frames');
const { resolveChannelProfile } = require('./channels');

const OBSERVATIONS_FILE = 'take-a-repo-observations.json';
const schema = require('../schemas/production-observations.schema.json');
const validate = new Ajv({ allErrors: true }).compile(schema);

function recipeFor(config, duration) {
  const options = config.production?.observations || {};
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['intervalSeconds', 'width', 'maxFrames'].includes(key))) throw new Error('invalid production.observations options');
  const { intervalSeconds = 2, width = 480, maxFrames = 240 } = options;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0.25 || intervalSeconds > 60
    || !Number.isInteger(width) || width < 160 || width > 1280
    || !Number.isInteger(maxFrames) || maxFrames < 2 || maxFrames > 1000) throw new Error('observations require intervalSeconds 0.25..60, width 160..1280 and maxFrames 2..1000');
  return { intervalSeconds: Math.max(intervalSeconds, duration / maxFrames), width, maxFrames };
}

function analyzerFingerprint() {
  return digest(stableJson({ schema, files: ['production-observe.js', 'production-frames.js'].map((file) => sha256File(path.join(__dirname, file))) }));
}

function prepareObservations(config, opts) {
  validateEvidenceConfig(config);
  const cwd = path.resolve(opts.cwd || process.cwd());
  const outDir = path.resolve(cwd, config.outDir || 'product-evidence');
  const previous = previousRun(outDir);
  if (!previous) throw new Error('no intact completed evidence; run production run first');
  const sources = [...new Set(config.evidence.deliverables.filter((d) => d.kind === 'video').map((d) => d.source))];
  if (!sources.length) throw new Error('observations require a video deliverable');
  if (opts.source !== undefined && !sources.includes(opts.source)) throw new Error('source must reference a configured video deliverable');
  const selected = opts.source === undefined ? sources : [opts.source];
  const items = selected.map((source) => {
    const [producer, id] = source.split(':');
    const asset = previous.report.producers.find((p) => p.id === producer)?.assets.find((a) => a.id === id);
    if (!asset?.mediaType.startsWith('video/') || !(asset.qa?.durationSeconds > 0) || !Number.isFinite(asset.qa.durationSeconds)) throw new Error(`missing measured source video: ${source}`);
    return { source, asset, file: safeAssetPath(previous.runDir, { outPath: asset.path }), recipe: recipeFor(config, asset.qa.durationSeconds) };
  });
  return { outDir, previous, items, analyzer: analyzerFingerprint() };
}

function readIndex(outDir, entry, item, analyzer) {
  if (!entry || entry.source !== item.source) throw new Error('source has no observations; run production observe');
  const file = safeAssetPath(outDir, { outPath: entry.path });
  if (!file || sha256File(file) !== entry.sha256) throw new Error('observation index changed; run production observe');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!validate(index) || index.source.ref !== item.source || index.source.sha256 !== item.asset.sha256
    || index.source.durationSeconds !== item.asset.qa.durationSeconds || index.analyzer !== analyzer
    || stableJson(index.recipe) !== stableJson(item.recipe)) throw new Error('observations are stale or invalid; run production observe');
  let lastTime = -1;
  if (index.frames.length > index.recipe.maxFrames) throw new Error('observation frame budget exceeded');
  for (const frame of index.frames) {
    const framePath = safeAssetPath(path.dirname(file), { outPath: frame.path });
    if (!framePath || sha256File(framePath) !== frame.sha256 || fs.statSync(framePath).size !== frame.bytes
      || frame.atSeconds <= lastTime || frame.atSeconds >= index.source.durationSeconds) throw new Error('observation frames changed or invalid; run production observe');
    lastTime = frame.atSeconds;
  }
  return { index, file };
}

async function observeProduction(config, opts = {}) {
  const started = performance.now();
  const cwd = path.resolve(opts.cwd || process.cwd());
  const outDir = path.resolve(cwd, config.outDir || 'product-evidence');
  return withProjectLock(outDir, async () => {
    if (fs.existsSync(path.join(outDir, '.take-a-repo.lock'))) throw new Error('capture output is locked');
    const p = prepareObservations(config, opts);
    const tool = observationTool();
    const pointer = readJsonIfExists(path.join(outDir, OBSERVATIONS_FILE));
    const entries = Array.isArray(pointer?.sources) ? pointer.sources.filter((entry) => entry && typeof entry.source === 'string' && typeof entry.path === 'string' && typeof entry.sha256 === 'string') : [];
    const sources = [];
    for (const item of p.items) {
      let cached;
      try { cached = readIndex(outDir, entries.find((entry) => entry.source === item.source), item, p.analyzer); }
      catch (_error) { /* a stale or damaged analysis is rebuilt from verified source */ }
      if (cached?.index.tool === tool.fingerprint) {
        sources.push({ source: item.source, index: cached.file, reused: true, frames: cached.index.frames.length });
        continue;
      }
      const root = safeAssetPath(outDir, { outPath: 'observations' });
      if (!root) throw new Error('observations directory must stay inside the output directory');
      fs.mkdirSync(root, { recursive: true });
      const directory = fs.mkdtempSync(path.join(root, 'analysis-'));
      try {
        opts.log?.(`observe ${item.source} at ${item.recipe.intervalSeconds}s intervals`);
        const frames = extractObservationFrames(item.file, directory, item.recipe, tool);
        const index = {
          version: 1, kind: 'take-a-repo.observations', createdAt: new Date().toISOString(),
          authority: 'observation-only', analyzer: p.analyzer, tool: tool.fingerprint,
          source: { ref: item.source, sha256: item.asset.sha256, durationSeconds: item.asset.qa.durationSeconds },
          recipe: item.recipe, frames,
        };
        if (!validate(index)) throw new Error('invalid extracted observations');
        if (sha256File(item.file) !== item.asset.sha256) throw new Error('source changed during observation');
        const file = path.join(directory, 'index.json');
        writeJson(file, index);
        const entry = { source: item.source, path: path.relative(outDir, file), sha256: sha256File(file) };
        readIndex(outDir, entry, item, p.analyzer);
        const pos = entries.findIndex((old) => old.source === item.source);
        if (pos === -1) entries.push(entry); else entries[pos] = entry;
        sources.push({ source: item.source, index: file, reused: false, frames: frames.length });
      } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
      }
    }
    // Indexes are immutable. Atomically publish the complete batch only when
    // the source report still matches; this never alters evidence or approval.
    if (sha256File(p.previous.manifest) !== p.previous.reportHash) throw new Error('source report changed during observation');
    for (const item of p.items) if (sha256File(item.file) !== item.asset.sha256) throw new Error('source changed during observation');
    writeJson(path.join(outDir, OBSERVATIONS_FILE), { version: 1, sources: entries });
    return { sources, metrics: { modelCalls: 0, analyzedSources: sources.filter((s) => !s.reused).length, reusedSources: sources.filter((s) => s.reused).length, elapsedMs: Math.round(performance.now() - started) } };
  });
}

function selectFrames(frames, from, to, maxFrames) {
  const available = frames.filter((frame) => frame.atSeconds >= from && frame.atSeconds < to);
  if (available.length <= maxFrames) return { available: available.length, selected: available };
  const selected = Array.from({ length: maxFrames }, (_, i) => available[Math.round(i * (available.length - 1) / (maxFrames - 1))]);
  return { available: available.length, selected };
}

function productionContext(config, opts = {}) {
  const p = prepareObservations(config, opts);
  if (p.items.length !== 1) throw new Error('context requires --source when multiple videos are configured');
  const item = p.items[0];
  const { from = 0, to = item.asset.qa.durationSeconds, maxFrames = 8 } = opts;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > item.asset.qa.durationSeconds
    || !Number.isInteger(maxFrames) || maxFrames < 2 || maxFrames > 32) throw new Error('context requires 0 <= from < to <= duration and maxFrames 2..32');
  const pointer = readJsonIfExists(path.join(p.outDir, OBSERVATIONS_FILE));
  const entry = Array.isArray(pointer?.sources) && pointer.sources.find((s) => s.source === item.source);
  const { index, file } = readIndex(p.outDir, entry, item, p.analyzer);
  // Integrity stays on disk and is checked above; do not spend model context
  // repeating per-frame hashes or storage bookkeeping.
  const all = index.frames.map(({ atSeconds, path: framePath, width, height }) => ({ atSeconds, path: path.resolve(path.dirname(file), framePath), width, height }));
  const { available, selected } = selectFrames(all, from, to, maxFrames);
  const project = readProject(p.outDir);
  const effective = project ? applyProject(config, project) : config;
  const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
  const fullBytes = bytes(all), selectedBytes = bytes(selected);
  return {
    version: 1, kind: 'take-a-repo.production-context', authority: 'observation-only',
    source: index.source, sourceRunId: p.previous.report.id, index: file,
    range: { from, to, timebase: 'source-seconds', endExclusive: true },
    coverage: { intervalSeconds: index.recipe.intervalSeconds, availableFrames: available, returnedFrames: selected.length, subsampled: available > selected.length, completeEventCoverage: false },
    frames: selected,
    editContext: { baseRevision: project?.revision ?? null, deliverables: effective.evidence.deliverables.filter((d) => d.kind === 'video' && d.source === item.source).map((d) => ({
      id: d.id, channel: d.channel, trim: d.trim || null, captions: d.captions || [],
      constraints: { durationSeconds: resolveChannelProfile(d.channel).recommendedDurationSeconds, trimMustFitSource: true, maxCaptions: 40, captionTimebase: 'output-seconds' },
    })) },
    metrics: { modelCalls: 0, fullFrames: all.length, returnedFrames: selected.length, fullFrameJsonBytes: fullBytes, returnedFrameJsonBytes: selectedBytes, frameJsonReductionPercent: Math.round((1 - selectedBytes / fullBytes) * 10000) / 100, fullImageBytes: index.frames.reduce((sum, f) => sum + f.bytes, 0), returnedImageBytes: selected.reduce((sum, f) => sum + index.frames.find((frame) => frame.atSeconds === f.atSeconds).bytes, 0), actualModelTokens: null },
    guidance: 'Inspect selected frame files. Samples can miss brief events; request a narrower range or denser observations when needed. Trim uses source seconds; caption times use edited-output seconds. Apply edits with baseRevision via production edit, then production run. These observations do not prove current product behavior or grant publication approval.',
  };
}

module.exports = { OBSERVATIONS_FILE, observeProduction, productionContext, selectFrames };
