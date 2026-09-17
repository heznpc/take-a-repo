const fs = require('fs');
const os = require('os');
const path = require('path');
const { observeProduction, productionContext, OBSERVATIONS_FILE } = require('../src/production-observe');
const { sha256File, writeJson } = require('../src/handoff-files');
const { newProject, saveProject } = require('../src/production-project');
const { editProduction } = require('../src/production');
const { runProductionCommand } = require('../src/production-cli');
const { observationTool, extractObservationFrames } = require('../src/production-frames');

jest.mock('../src/production-frames', () => ({ observationTool: jest.fn(), extractObservationFrames: jest.fn() }));

let cwd, outDir, runDir, config;
function publishRun(contents = 'fixture source video', duration = 60) {
  fs.writeFileSync(path.join(runDir, 'source.mp4'), contents);
  const asset = { id: 'video', path: 'source.mp4', mediaType: 'video/mp4', bytes: contents.length, sha256: sha256File(path.join(runDir, 'source.mp4')), qa: { durationSeconds: duration } };
  const report = { id: 'run-fixture', kind: 'take-a-repo.evidence-run', machineStatus: 'publish-ready', scope: { full: true }, files: [asset], producers: [{ id: 'local', assets: [asset] }] };
  writeJson(path.join(runDir, 'report.json'), report);
  writeJson(path.join(outDir, 'take-a-repo-evidence.json'), { state: 'completed', id: report.id, run: 'runs/fixture/report.json', sha256: sha256File(path.join(runDir, 'report.json')) });
  writeJson(path.join(outDir, '.take-a-repo-run.json'), { status: 'completed' });
}
beforeEach(() => {
  jest.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-observe-'));
  outDir = path.join(cwd, 'evidence');
  runDir = path.join(outDir, 'runs/fixture');
  fs.mkdirSync(runDir, { recursive: true });
  config = { outDir: 'evidence', evidence: { version: 1,
    producers: [{ id: 'local', kind: 'cli', command: ['node', 'collect.js'] }],
    claims: [{ id: 'loaded', text: 'Saved footage loaded', checks: ['local:loaded'] }],
    deliverables: [{ id: 'demo', kind: 'video', source: 'local:video', channel: 'x', fit: 'contain', claims: ['loaded'] }],
  } };
  publishRun();
  saveProject(outDir, newProject());
  observationTool.mockReturnValue({ bin: 'test-ffmpeg', fingerprint: 'a'.repeat(64) });
  extractObservationFrames.mockImplementation((_source, dir, recipe) => Array.from({ length: 30 }, (_, i) => {
    const file = `frame-${String(i + 1).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(dir, file), `unit-test-frame-${i}`);
    return { atSeconds: i * 2, path: file, sha256: sha256File(path.join(dir, file)), bytes: fs.statSync(path.join(dir, file)).size, width: recipe.width, height: 270 };
  }));
});
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

test('indexes once, reuses across editorial revisions and returns source-relative bounded context', async () => {
  const originalReport = fs.readFileSync(path.join(runDir, 'report.json'));
  expect((await observeProduction(config, { cwd })).metrics).toMatchObject({ analyzedSources: 1, reusedSources: 0 });
  expect((await observeProduction(config, { cwd })).metrics).toMatchObject({ analyzedSources: 0, reusedSources: 1 });
  await editProduction(config, { baseRevision: 1, operations: [{ deliverable: 'demo', set: { trim: { start: 10, duration: 8 }, captions: [{ id: 'intro', start: 0, end: 3, text: 'Saved footage' }] } }] }, { cwd });
  const context = productionContext(config, { cwd, from: 10, to: 18, maxFrames: 3 });
  expect(context.frames.map((f) => f.atSeconds)).toEqual([10, 14, 16]);
  expect(context.coverage).toMatchObject({ availableFrames: 4, returnedFrames: 3, subsampled: true, completeEventCoverage: false });
  expect(context.editContext).toMatchObject({ baseRevision: 2, deliverables: [{ id: 'demo', trim: { start: 10, duration: 8 }, constraints: { durationSeconds: { min: 20, max: 40 }, trimMustFitSource: true } }] });
  expect(context.metrics).toMatchObject({ fullFrames: 30, returnedFrames: 3, modelCalls: 0, actualModelTokens: null });
  expect(context.metrics.frameJsonReductionPercent).toBeGreaterThan(85);
  expect(context.metrics.returnedFrameJsonBytes).toBe(Buffer.byteLength(JSON.stringify(context.frames)));
  expect(extractObservationFrames).toHaveBeenCalledTimes(1);
  expect(fs.readFileSync(path.join(runDir, 'report.json'))).toEqual(originalReport);
});

test('source changes, recipe changes, tool changes and corrupted frames trigger fresh analysis', async () => {
  const first = await observeProduction(config, { cwd });
  const index = JSON.parse(fs.readFileSync(first.sources[0].index));
  fs.appendFileSync(path.join(path.dirname(first.sources[0].index), index.frames[0].path), 'tampered');
  expect(() => productionContext(config, { cwd })).toThrow(/frames changed/);
  expect((await observeProduction(config, { cwd })).metrics.analyzedSources).toBe(1);
  publishRun('new source video');
  expect(() => productionContext(config, { cwd })).toThrow(/stale/);
  expect((await observeProduction(config, { cwd })).metrics.analyzedSources).toBe(1);
  config.production = { observations: { width: 640 } };
  expect(() => productionContext(config, { cwd })).toThrow(/stale/);
  expect((await observeProduction(config, { cwd })).metrics.analyzedSources).toBe(1);
  observationTool.mockReturnValue({ bin: 'test-ffmpeg', fingerprint: 'b'.repeat(64) });
  expect((await observeProduction(config, { cwd })).metrics.analyzedSources).toBe(1);
  expect(extractObservationFrames).toHaveBeenCalledTimes(5);
});

test('corrupt indexes and escaping or symlinked frame paths are never returned', async () => {
  const result = await observeProduction(config, { cwd });
  const file = result.sources[0].index;
  fs.appendFileSync(file, 'broken');
  expect(() => productionContext(config, { cwd })).toThrow(/index changed/);
  const rebuilt = await observeProduction(config, { cwd });
  const indexFile = rebuilt.sources[0].index;
  const index = JSON.parse(fs.readFileSync(indexFile));
  const frame = path.join(path.dirname(indexFile), index.frames[0].path);
  const outside = path.join(cwd, 'outside.png');
  fs.copyFileSync(frame, outside);
  fs.unlinkSync(frame);
  fs.symlinkSync(outside, frame);
  expect(() => productionContext(config, { cwd })).toThrow(/frames changed/);
  const pointer = JSON.parse(fs.readFileSync(path.join(outDir, OBSERVATIONS_FILE)));
  pointer.sources[0].path = '../outside.png';
  writeJson(path.join(outDir, OBSERVATIONS_FILE), pointer);
  expect(() => productionContext(config, { cwd })).toThrow(/index changed/);
});

test('empty ranges are explicit; default context samples the entire index within its budget', async () => {
  await observeProduction(config, { cwd });
  const empty = productionContext(config, { cwd, from: 0.1, to: 0.2 });
  expect(empty.frames).toEqual([]);
  expect(empty.coverage.availableFrames).toBe(0);
  const overview = productionContext(config, { cwd });
  expect(overview.frames).toHaveLength(8);
  expect(overview.frames[0].atSeconds).toBe(0);
  expect(overview.frames.at(-1).atSeconds).toBe(58);
  for (const options of [{ from: -1 }, { from: 5, to: 5 }, { to: 61 }, { maxFrames: 1 }, { maxFrames: 33 }, { maxFrames: 2.5 }]) {
    expect(() => productionContext(config, { cwd, ...options })).toThrow(/context requires/);
  }
});

test('failed extraction leaves the previous index pointer intact and releases the lock', async () => {
  await observeProduction(config, { cwd });
  const before = fs.readFileSync(path.join(outDir, OBSERVATIONS_FILE));
  config.production = { observations: { width: 640 } };
  extractObservationFrames.mockImplementationOnce(() => { throw new Error('decoder failed'); });
  await expect(observeProduction(config, { cwd })).rejects.toThrow('decoder failed');
  expect(fs.readFileSync(path.join(outDir, OBSERVATIONS_FILE))).toEqual(before);
  expect(fs.existsSync(path.join(outDir, '.take-a-repo-project.lock'))).toBe(false);
  expect((await observeProduction(config, { cwd })).metrics.analyzedSources).toBe(1);
});

test('rejects missing or tampered source evidence, unknown sources and unbounded settings', async () => {
  await expect(observeProduction(config, { cwd, source: 'local:missing' })).rejects.toThrow(/configured/);
  for (const options of [{ width: 5000 }, { intervalSeconds: 0 }, { maxFrames: 1001 }, { typo: true }]) {
    config.production = { observations: options };
    await expect(observeProduction(config, { cwd })).rejects.toThrow(/observations/);
  }
  delete config.production;
  fs.appendFileSync(path.join(runDir, 'source.mp4'), 'tamper');
  await expect(observeProduction(config, { cwd })).rejects.toThrow(/no intact/);
});

test('long recordings widen the sampling interval to bound analysis work', async () => {
  publishRun('long recording', 3600);
  await observeProduction(config, { cwd });
  expect(extractObservationFrames.mock.calls[0][2]).toEqual({ intervalSeconds: 15, width: 480, maxFrames: 240 });
});

test('a corrupt pointer is recoverable and analysis cannot escape through a symlink', async () => {
  writeJson(path.join(outDir, OBSERVATIONS_FILE), { sources: [null, 42, {}] });
  expect((await observeProduction(config, { cwd })).metrics.analyzedSources).toBe(1);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-outside-'));
  try {
    fs.renameSync(path.join(outDir, 'observations'), path.join(outDir, 'saved-observations'));
    fs.symlinkSync(other, path.join(outDir, 'observations'));
    await expect(observeProduction(config, { cwd })).rejects.toThrow(/inside the output/);
    expect(fs.readdirSync(other)).toEqual([]);
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
});

test('CLI delivers one compact JSON object and rejects flags for unrelated actions', async () => {
  fs.writeFileSync(path.join(cwd, 'take-a-repo.config.js'), `module.exports=${JSON.stringify(config)}`);
  let stdout = '';
  const io = { stdout: { write: (s) => { stdout += s; } }, stderr: { write: () => {} }, processCwd: () => cwd };
  expect(await runProductionCommand(['production', 'observe', '--json'], io)).toBe(0);
  expect(JSON.parse(stdout).metrics.analyzedSources).toBe(1);
  stdout = '';
  expect(await runProductionCommand(['production', 'context', '--source', 'local:video', '--from', '10', '--to', '18', '--json'], io)).toBe(0);
  expect(JSON.parse(stdout).frames).toHaveLength(4);
  for (const args of [['run', '--from', '10'], ['status', '--source', 'local:video'], ['context', '--max-frames', '33'], ['context', '--from', 'bad'], ['context', '--to', '0']]) {
    stdout = '';
    expect(await runProductionCommand(['production', ...args, '--json'], io)).toBe(2);
    expect(JSON.parse(stdout).ok).toBe(false);
  }
});
