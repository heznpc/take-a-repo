const fs = require('fs');
const os = require('os');
const path = require('path');
const { reviewContext, recordEditorialReview } = require('../src/production-review');
const { selectedObservationFrames } = require('../src/production-frames');
const { evidenceState } = require('../src/evidence-state');
const { sha256File, writeJson } = require('../src/handoff-files');
const { REVIEW_CRITERIA } = require('../src/editorial');
const { validateEditorialBrief } = require('../src/editorial');
const { buildCaptionFrames } = require('../src/demo-caption-focus');
const { validateScript, sourceDigest } = require('../src/demo-authoring');
const { validateEditorial } = require('../src/production-render');
const { analyzeDemoStoryboard } = require('../src/demo-storyboard');

jest.mock('../src/production-frames', () => ({ selectedObservationFrames: jest.fn() }));
let cwd, runDir, config, report;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-editorial-'));
  runDir = path.join(cwd, 'evidence/runs/fixture'); fs.mkdirSync(runDir, { recursive: true });
  config = { outDir: 'evidence' };
  const file = path.join(runDir, 'final.mp4'); fs.writeFileSync(file, 'unit fixture final composite');
  const asset = { id: 'demo', path: 'final.mp4', mediaType: 'video/mp4', sha256: sha256File(file), qa: { durationSeconds: 6, width: 720, height: 1280 } };
  report = { version: 1, kind: 'take-a-repo.evidence-run', id: 'fixture', machineStatus: 'publish-ready', scope: { full: true },
    producers: [], actions: [], assetSetDigest: 'fixture', files: [asset], editorialReviewRequired: true,
    deliverables: [{ id: 'demo', kind: 'video', channel: 'youtube-shorts', status: 'rendered', files: ['final.mp4'],
      editorial: { objective: 'Inspect the changed UI', audience: 'A new user', rationale: 'Prove the visible change before explaining it',
        beats: [{ id: 'result', role: 'result', start: 0, end: 6, subject: 'Result area', expectedChange: 'Result becomes visible', attention: 'Result then caption', holdReason: 'Read the new value' }] } }] };
  saveRun();
  selectedObservationFrames.mockImplementation((_video, outDir, recipe) => recipe.times.map((atSeconds, i) => {
    const file = path.join(outDir, `frame-${atSeconds}.png`); fs.writeFileSync(file, `unit fixture ${atSeconds}`);
    return { id: `frame-${atSeconds}-${i}`, atSeconds, path: file, sha256: sha256File(file), width: recipe.width, height: 1280 };
  }));
});
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); jest.clearAllMocks(); });
function saveRun() {
  writeJson(path.join(runDir, 'run.json'), report);
  writeJson(path.join(cwd, 'evidence/take-a-repo-evidence.json'), { state: 'completed', id: report.id, run: 'runs/fixture/run.json', sha256: sha256File(path.join(runDir, 'run.json')) });
  writeJson(path.join(cwd, 'evidence/.take-a-repo-run.json'), { status: 'completed' });
}
function critique(context) {
  // Synthetic reviewer input only; production never supplies passing verdicts.
  return { reviewDigest: context.reviewDigest, deliverables: [{ id: 'demo', contexts: [context.contextId], checks: REVIEW_CRITERIA.map((criterion) => ({
    criterion, status: 'pass', reason: 'Synthetic review fixture, not a creative-quality claim', frames: context.frames.map((f) => f.id),
  })) }] };
}

test('technical success and keyword captions do not bypass the agent review or human approval', async () => {
  expect(analyzeDemoStoryboard({ captions: [{ at: 0, text: 'Welcome' }, { at: 2, text: 'Original' }], mp4: true, trim: { duration: 6 } })).toEqual([]);
  const before = evidenceState(path.join(cwd, 'evidence'));
  expect(before).toMatchObject({ status: 'needs-fix', machineStatus: 'publish-ready', humanApprovalReady: false, editorialReview: { status: 'pending' } });
  const context = reviewContext(config, { cwd, maxFrames: 4 });
  expect(selectedObservationFrames.mock.calls[0][0]).toBe(path.join(runDir, 'final.mp4'));
  expect(context.frames[0].width).toBe(720);
  expect(context.authoring.captionFields).toContain('focusCues');
  await recordEditorialReview(config, critique(context), { cwd });
  expect(evidenceState(path.join(cwd, 'evidence'))).toMatchObject({ status: 'awaiting-approval', publishable: false, humanApprovalReady: true, editorialReview: { status: 'reviewed' } });
});

test('routine review CLI returns a report reference without replaying the critique into model context', async () => {
  const context = reviewContext(config, { cwd, maxFrames: 4 });
  fs.writeFileSync(path.join(cwd, 'take-a-repo.config.js'), `module.exports = ${JSON.stringify(config)}`);
  writeJson(path.join(cwd, 'critique.json'), critique(context));
  let output = '';
  const code = await require('../src/production-cli').runProductionCommand(['production', 'review', '--report', 'critique.json', '--json'], {
    processCwd: () => cwd, stdout: { write: (value) => { output += value; } },
  });
  expect(code).toBe(0);
  expect(JSON.parse(output).editorialReview).toMatchObject({ status: 'reviewed', reviewDigest: context.reviewDigest, path: expect.any(String) });
  expect(output).not.toContain('Synthetic review fixture');
});

test('missing intent, incomplete criteria and unknown frame references cannot pass', async () => {
  const context = reviewContext(config, { cwd });
  const missing = critique(context); missing.deliverables[0].checks.pop();
  await expect(recordEditorialReview(config, missing, { cwd })).rejects.toThrow('five');
  const fake = critique(context); fake.deliverables[0].checks[0].frames = ['never-inspected'];
  await expect(recordEditorialReview(config, fake, { cwd })).rejects.toThrow('inspected');
  delete report.deliverables[0].editorial; saveRun();
  const noIntent = reviewContext(config, { cwd });
  await expect(recordEditorialReview(config, critique(noIntent), { cwd })).rejects.toThrow('author the editorial');
});

test('changed candidates, contexts and pixels invalidate review submissions', async () => {
  const context = reviewContext(config, { cwd });
  fs.appendFileSync(context.frames[0].path, 'tampered');
  await expect(recordEditorialReview(config, critique(context), { cwd })).rejects.toThrow('frame changed');
  const refreshed = reviewContext(config, { cwd });
  const file = path.join(cwd, `evidence/editorial-contexts/${refreshed.contextId}.json`);
  const changed = JSON.parse(fs.readFileSync(file)); changed.frames[0].atSeconds = 5; writeJson(file, changed);
  await expect(recordEditorialReview(config, critique(refreshed), { cwd })).rejects.toThrow('changed');
  report.assetSetDigest = 'new candidate'; saveRun();
  await expect(recordEditorialReview(config, critique(context), { cwd })).rejects.toThrow('digest');
});

test('uninspected beats cannot pass and failed critiques remain agent-owned work', async () => {
  const first = report.deliverables[0].editorial.beats[0];
  first.end = 3; report.deliverables[0].editorial.beats.push({ ...first, id: 'second', start: 3, end: 6 }); saveRun();
  const context = reviewContext(config, { cwd, from: 0, to: 2 });
  expect(context.coverage.uncoveredBeats).toContain('second');
  await expect(recordEditorialReview(config, critique(context), { cwd })).rejects.toThrow('two full frames per beat');
  const failed = critique(context); failed.deliverables[0].checks[0] = { ...failed.deliverables[0].checks[0], status: 'fail', reason: '0–2s: result region is not readable; enlarge the product framing' };
  await recordEditorialReview(config, failed, { cwd });
  expect(evidenceState(path.join(cwd, 'evidence'))).toMatchObject({ status: 'needs-fix', publishable: false, editorialReview: { status: 'changes-requested' } });
});

test('authored cues select emphasis and release it during a product-reading hold', () => {
  const caption = { atMs: 1000, text: 'Keep the code', focusChunks: ['Keep the code'], focusCues: [{ at: 0, chunk: 0, word: 2 }, { at: 0.6, chunk: 0, word: null }] };
  const frames = buildCaptionFrames([caption, { atMs: 4000, text: '' }], { mode: 'focus' });
  expect(frames.slice(0, 2).map((f) => [f.atMs, f.options.activeWordIndex])).toEqual([[1000, 2], [1600, null]]);
  for (const focusCues of [[{ at: 0.2, chunk: 0, word: 0 }], [{ at: 0, chunk: 0, word: 5 }], [{ at: 0, chunk: 0, word: 0 }, { at: 3, chunk: 0, word: null }]]) {
    expect(() => buildCaptionFrames([{ ...caption, focusCues }, { atMs: 4000, text: '' }], { mode: 'focus' })).toThrow('focusCues');
  }
});

test('editorial intent cannot omit the uneventful tail or overlap viewing beats', () => {
  const brief = report.deliverables[0].editorial;
  brief.beats[0].end = 3;
  expect(() => validateEditorialBrief(brief, 6)).toThrow('full edited duration');
  brief.beats.push({ ...brief.beats[0], id: 'end', start: 2, end: 6 });
  expect(() => validateEditorialBrief(brief, 6)).toThrow('consecutive');
});

test('Korean semantic cues work in quick scripts and production; shot order is authored', () => {
  const text = '전문 용어는 그대로';
  const beat = { role: 'proof', anchor: 'heading-0', text, holdMs: 3000, focusChunks: [text], focusCues: [{ at: 0, chunk: 0, word: 2 }, { at: 0.8, chunk: 0, word: null }] };
  const script = { version: 1, language: 'ko', sourceDigest: sourceDigest({ title: 'Fixture', headings: [], paragraphs: [] }), beats: [beat, { ...beat, anchor: 'top' }] };
  expect(() => validateScript(script)).not.toThrow();
  expect(() => validateEditorial({ id: 'demo', channel: 'youtube-shorts', captionOptions: { typography: { locale: 'ko', fonts: [{ family: 'fixture', from: 'fixture.ttf' }] } }, captions: [{ id: 'proof', start: 0, end: 3, text, role: beat.role, focusChunks: beat.focusChunks, focusCues: beat.focusCues }] })).not.toThrow();
});
