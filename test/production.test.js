const fs = require('fs');
const os = require('os');
const path = require('path');
const { planProduction, runProduction, editProduction } = require('../src/production');
const { evidenceState } = require('../src/evidence-state');
const { PROJECT_FILE, readProject, newProject, saveProject, applyProject, withProjectLock } = require('../src/production-project');
const { withRunSession } = require('../src/run-session');
const { renderKey, reusableProducer } = require('../src/production-cache');
const { validateEditorial } = require('../src/production-render');
const { runProductionCommand } = require('../src/production-cli');
const { captureEvidence } = require('../src/evidence-runner');

let cwd;
const opts = () => ({ cwd, log: () => {} });
const outDir = () => path.join(cwd, 'evidence');
function config() {
  return { outDir: 'evidence', evidence: {
    version: 1,
    producers: [{ id: 'cli', kind: 'cli', command: [process.execPath, 'collect.js'],
      reuse: { mode: 'local-inputs', inputs: ['collect.js', 'source.txt'], maxAgeSeconds: 3600 } }],
    claims: [{ id: 'works', text: 'Local collector ran', checks: ['cli:checked'] }],
    deliverables: [{ id: 'proof', kind: 'proof', claims: ['works'] }],
  } };
}
const video = { id: 'demo', kind: 'video', claims: ['works'], source: 'cli:video', channel: 'x', fit: 'contain' };
const caption = { id: 'intro', start: 0, end: 3, text: 'Reusable footage' };
const count = () => Number(fs.readFileSync(path.join(cwd, 'count'), 'utf8'));

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-production-'));
  fs.writeFileSync(path.join(cwd, 'source.txt'), 'original');
  fs.writeFileSync(path.join(cwd, 'collect.js'), `
const fs = require('fs');
const path = require('path');
const out = process.env.TAKE_A_REPO_OUTPUT_DIR;
const count = fs.existsSync('count') ? Number(fs.readFileSync('count')) : 0;
fs.writeFileSync('count', String(count + 1));
fs.copyFileSync('source.txt', path.join(out, 'result.txt'));
fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify({version:1,
assets:[{id:'result',path:'result.txt',mediaType:'text/plain',role:'transcript'}],
checks:[{id:'checked',status:'pass',summary:'Local input copied',assets:['result']}]}));
`);
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(cwd, { recursive: true, force: true }); });

test('unchanged production retains the exact candidate without executing or rendering', async () => {
  const spec = config();
  expect(planProduction(spec, opts()).producers[0].action).toBe('execute');
  const first = await runProduction(spec, opts());
  expect(first).toMatchObject({ status: 'awaiting-approval', metrics: { executedProducers: 1, modelCalls: 0 } });
  const before = fs.readFileSync(first.manifest);
  expect(planProduction(spec, opts())).toMatchObject({ unchanged: true, producers: [{ action: 'reuse' }] });
  const second = await runProduction(spec, opts());
  expect(second).toMatchObject({ reusedCandidate: true, manifest: first.manifest, metrics: { executedProducers: 0, renderedDeliverables: 0 } });
  expect(count()).toBe(1);
  expect(fs.readFileSync(first.manifest)).toEqual(before);
});

test('copy changes reuse checks with original provenance and create a separate approval candidate', async () => {
  const spec = config();
  await runProduction(spec, opts());
  const first = evidenceState(outDir());
  // Test fixture only. Production approval remains a human action.
  fs.writeFileSync(path.join(first.runDir, 'review.json'), JSON.stringify({ status: 'approved', reviewDigest: first.reviewDigest }));
  spec.evidence.claims[0].text = 'Changed description';
  const result = await runProduction(spec, opts());
  expect(result.metrics).toMatchObject({ executedProducers: 0, reusedProducers: 1, renderedDeliverables: 1 });
  const second = evidenceState(outDir());
  expect(second).toMatchObject({ status: 'awaiting-approval', publishable: false });
  expect(second.report.producers[0]).toMatchObject({ mode: 'reused', origin: { runId: first.id }, checks: [{ verification: 'reused-producer-asserted' }] });
  expect(second.id).not.toBe(first.id);
  expect(count()).toBe(1);
});

test('changed inputs and forced refresh execute again; source tampering invalidates status immediately', async () => {
  const spec = config();
  await runProduction(spec, opts());
  fs.writeFileSync(path.join(cwd, 'source.txt'), 'updated');
  expect(evidenceState(outDir()).problems).toContainEqual({ code: 'producer-inputs-changed', producer: 'cli' });
  expect(planProduction(spec, opts()).producers[0].action).toBe('execute');
  expect((await runProduction(spec, opts())).metrics.executedProducers).toBe(1);
  expect((await runProduction(spec, { ...opts(), fresh: true })).metrics.executedProducers).toBe(1);
  expect(count()).toBe(3);
});

test('undeclared, environment-changed, expired and tampered captures are never reused', async () => {
  const spec = config();
  spec.evidence.producers[0].reuse.environment = ['TAKE_A_REPO_PRODUCTION_TEST'];
  const initial = process.env.TAKE_A_REPO_PRODUCTION_TEST;
  try {
    process.env.TAKE_A_REPO_PRODUCTION_TEST = 'first';
    await runProduction(spec, opts());
    process.env.TAKE_A_REPO_PRODUCTION_TEST = 'second';
    expect(evidenceState(outDir()).problems).toContainEqual({ code: 'producer-environment-changed', producer: 'cli' });
    expect(planProduction(spec, opts()).unchanged).toBe(false);
    await runProduction(spec, opts());
    const state = evidenceState(outDir());
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_601_000);
    expect(planProduction(spec, opts()).producers[0].action).toBe('execute');
    jest.restoreAllMocks();
    fs.appendFileSync(path.join(state.runDir, 'raw/cli/result.txt'), 'tamper');
    expect(planProduction(spec, opts()).producers[0].action).toBe('execute');
    delete spec.evidence.producers[0].reuse;
    await runProduction(spec, opts());
    expect(planProduction(spec, opts()).producers[0].action).toBe('execute');
  } finally {
    if (initial === undefined) delete process.env.TAKE_A_REPO_PRODUCTION_TEST;
    else process.env.TAKE_A_REPO_PRODUCTION_TEST = initial;
  }
});

test('a failed render preserves the last valid capture for the next repair', async () => {
  const spec = config();
  await runProduction(spec, opts());
  spec.evidence.deliverables.push(video); // deliberately missing source video
  expect((await runProduction(spec, opts())).machineStatus).toBe('needs-fix');
  spec.evidence.deliverables.pop();
  spec.evidence.claims[0].text = 'Repair the description';
  const repair = await runProduction(spec, opts());
  expect(repair).toMatchObject({ machineStatus: 'publish-ready', metrics: { executedProducers: 0, reusedProducers: 1 } });
  expect(count()).toBe(1);
});

test.each([1, 3])('the first render failure retains verified sources without approving the candidate (attempt %i)', async (attempt) => {
  const spec = config();
  spec.evidence.deliverables.push(video); // Render failure after a successful producer.
  const first = await runProduction(spec, { ...opts(), attempt });
  expect(first.machineStatus).toBe(attempt === 3 ? 'blocked' : 'needs-fix');
  expect(evidenceState(outDir()).publishable).toBe(false);
  expect(planProduction(spec, opts())).toMatchObject({ unchanged: false, producers: [{ action: 'reuse' }], deliverables: [{ action: 'render' }, { action: 'render' }] });
  const retry = await runProduction(spec, opts());
  expect(retry).toMatchObject({ reusedCandidate: false, machineStatus: 'needs-fix', metrics: { executedProducers: 0, reusedProducers: 1 } });
  spec.evidence.deliverables.pop();
  const repair = await runProduction(spec, opts());
  expect(repair).toMatchObject({ status: 'awaiting-approval', metrics: { executedProducers: 0, reusedProducers: 1 } });
  expect(evidenceState(outDir()).publishable).toBe(false);
  expect(count()).toBe(1);
});

test('a changed input during a failed render cannot seed the source cache', async () => {
  const spec = config();
  spec.evidence.deliverables.push(video);
  fs.appendFileSync(path.join(cwd, 'collect.js'), "\nfs.appendFileSync('source.txt', 'changed during capture');\n");
  const result = await runProduction(spec, opts());
  const report = JSON.parse(fs.readFileSync(result.manifest));
  expect(report.actions).toContainEqual(expect.objectContaining({ code: 'run-failed' }));
  expect(report.production.captureVerified).not.toBe(true);
  expect(fs.existsSync(path.join(outDir(), 'take-a-repo-production-cache.json'))).toBe(false);
  expect(planProduction(spec, opts()).producers[0].action).toBe('execute');
});

test('tampered footage from an initially failed render must be collected again', async () => {
  const spec = config();
  spec.evidence.deliverables.push(video);
  const first = await runProduction(spec, opts());
  fs.appendFileSync(path.join(path.dirname(first.manifest), 'raw/cli/result.txt'), 'tampered');
  expect(planProduction(spec, opts()).producers[0].action).toBe('execute');
});

test('an interrupted run is planned as a new candidate while preserving reusable footage', async () => {
  const spec = config();
  const first = await runProduction(spec, opts());
  fs.writeFileSync(path.join(outDir(), '.take-a-repo-run.json'), JSON.stringify({ status: 'failed' }));
  expect(planProduction(spec, opts())).toMatchObject({ unchanged: false, producers: [{ action: 'reuse' }], deliverables: [{ action: 'render' }] });
  const recovered = await runProduction(spec, opts());
  expect(recovered).toMatchObject({ reusedCandidate: false, machineStatus: 'publish-ready', metrics: { executedProducers: 0 } });
  expect(recovered.manifest).not.toBe(first.manifest);
});

test('build reuse requires source and output fingerprints; undeclared builds always execute', async () => {
  const spec = config();
  spec.build = `${JSON.stringify(process.execPath)} -e "require('fs').copyFileSync('source.txt','bundle.txt')"`;
  spec.evidence.inputs = ['source.txt', 'collect.js'];
  spec.evidence.buildOutputs = ['bundle.txt'];
  await runProduction(spec, opts());
  expect(planProduction(spec, opts()).build).toBe('reuse');
  fs.writeFileSync(path.join(cwd, 'bundle.txt'), 'tampered');
  expect(planProduction(spec, opts()).build).toBe('execute');
  await runProduction(spec, opts());
  expect(count()).toBe(2);
  delete spec.evidence.buildOutputs;
  await runProduction(spec, opts());
  await runProduction(spec, opts());
  expect(count()).toBe(4);
});

test('saved editorial patches are revision-bound, append history and protect evidence authority', async () => {
  const spec = config();
  spec.evidence.deliverables.push(video);
  saveProject(outDir(), newProject());
  const patch = { baseRevision: 1, operations: [{ deliverable: 'demo', set: { captions: [caption], trim: { start: 1, duration: 20 } } }] };
  const project = await editProduction(spec, patch, opts());
  expect(project.revision).toBe(2);
  expect(applyProject(spec, readProject(outDir())).evidence.deliverables[1].captions).toEqual([caption]);
  expect(fs.existsSync(path.join(outDir(), 'project-history', project.id, '1.json'))).toBe(true);
  await expect(editProduction(spec, patch, opts())).rejects.toThrow('revision conflict');
  for (const field of ['source', 'claims', 'checks', 'approval']) {
    await expect(editProduction(spec, { baseRevision: 2, operations: [{ deliverable: 'demo', set: { [field]: 'forged' } }] }, opts())).rejects.toThrow('protected');
  }
  await expect(editProduction(spec, { baseRevision: 2, operations: [{ deliverable: 'demo', set: { captions: [{ ...caption, end: 0 }] } }] }, opts())).rejects.toThrow();
  expect(readProject(outDir()).revision).toBe(2);
  expect((await editProduction(spec, { baseRevision: 2, operations: [{ deliverable: 'demo', reset: true }] }, opts())).edits).toEqual({});
});

test('project changes invalidate the candidate and imports cannot opt into execution reuse', async () => {
  const spec = config();
  await runProduction(spec, opts());
  fs.appendFileSync(path.join(outDir(), PROJECT_FILE), ' ');
  expect(evidenceState(outDir()).problems).toContainEqual({ code: 'project-changed-render-required' });
  delete spec.evidence.producers[0].command;
  spec.evidence.producers[0].import = 'evidence.json';
  expect(() => planProduction(spec, opts())).toThrow('imported evidence');
});

test('project and legacy capture locks cannot overlap or invalidate a candidate on rejection', async () => {
  await runProduction(config(), opts());
  const marker = path.join(outDir(), '.take-a-repo-run.json');
  const bytes = fs.readFileSync(marker);
  await withProjectLock(outDir(), async () => {
    await expect(withRunSession(outDir(), async () => {})).rejects.toThrow('locked');
    await expect(editProduction(config(), {}, opts())).rejects.toThrow('locked');
  });
  expect(fs.readFileSync(marker)).toEqual(bytes);
  await withRunSession(outDir(), async () => {
    await expect(runProduction(config(), opts())).rejects.toThrow('locked');
  });
});

test('render keys retain cached video across reuse labels and invalidate on editorial changes', () => {
  const producer = { id: 'cli', mode: 'executed', origin: { runId: 'original', finishedAt: new Date().toISOString() },
    checks: [{ id: 'checked', status: 'pass', verification: 'producer-asserted' }], assets: [{ id: 'video', sha256: 'abc' }] };
  const report = { producers: [producer], claims: [{ id: 'works', status: 'verified' }] };
  const key = renderKey(video, report, 'engine');
  producer.checks[0].verification = 'reused-producer-asserted';
  expect(renderKey(video, report, 'engine')).toBe(key);
  expect(renderKey({ ...video, captions: [caption] }, report, 'engine')).not.toBe(key);
  producer.assets[0].captionState = 'burned-in';
  expect(renderKey(video, report, 'engine')).not.toBe(key);
  producer.status = 'collected'; producer.reuseKey = 'key';
  expect(reusableProducer({ report }, producer, { maxAgeSeconds: 10 }, 'key', Date.now() + 11_000)).toBe(false);
});

test('editorial QA rejects overlap, duplicate IDs and empty copy before rendering', () => {
  for (const captions of [[caption, caption], [{ ...caption, text: ' ' }], [{ ...caption, start: 4, end: 3 }]]) {
    expect(() => validateEditorial({ ...video, captions })).toThrow();
  }
});

test('migration can reset edits for a removed or renamed deliverable without touching history', async () => {
  const spec = config();
  spec.evidence.deliverables.push(video);
  saveProject(outDir(), newProject());
  const edited = await editProduction(spec, { baseRevision: 1, operations: [{ deliverable: 'demo', set: { captions: [caption] } }] }, opts());
  const history = path.join(outDir(), 'project-history', edited.id, '2.json');
  const bytes = fs.readFileSync(history);
  spec.evidence.deliverables[1] = { ...video, id: 'renamed' };
  expect(() => planProduction(spec, opts())).toThrow('missing video demo');
  const reset = await editProduction(spec, { baseRevision: 2, operations: [{ deliverable: 'demo', reset: true }] }, opts());
  expect(reset).toMatchObject({ revision: 3, edits: {} });
  expect(fs.readFileSync(history)).toEqual(bytes);
  expect(planProduction(spec, opts()).deliverables.map((d) => d.id)).toEqual(['proof', 'renamed']);
});

test('an interrupted project-pointer write cannot permanently block subsequent edits', async () => {
  const spec = config(); spec.evidence.deliverables.push(video);
  const project = saveProject(outDir(), newProject());
  const orphan = path.join(outDir(), 'project-history', project.id, '2.json');
  fs.writeFileSync(orphan, JSON.stringify({ ...project, revision: 2, edits: { demo: { captions: [caption] } } }));
  const bytes = fs.readFileSync(orphan);
  const edited = await editProduction(spec, { baseRevision: 1, operations: [{ deliverable: 'demo', set: { captions: [{ ...caption, text: 'Recovered edit' }] } }] }, opts());
  expect(edited.revision).toBe(3);
  expect(fs.readFileSync(orphan)).toEqual(bytes);
  expect(readProject(outDir()).edits.demo.captions[0].text).toBe('Recovered edit');
});

test('caption validation enforces input type and typography bounds even when fitting is disabled', () => {
  expect(() => validateEditorial({ ...video, captions: {} })).toThrow('captions must be an array');
  for (const fit of ['none', 'shrink']) {
    const spec = { ...video, captionOptions: { typography: { minFontSize: 32, maxFontSize: 40, fit } }, captions: [{ ...caption, fontSize: 20 }] };
    expect(() => validateEditorial(spec)).toThrow('typography bounds');
  }
});

test('legacy capture migrates with a fresh execution, retains its old files and still works after production', async () => {
  const spec = config();
  const legacy = await captureEvidence(spec, opts());
  const old = evidenceState(outDir());
  const bytes = fs.readFileSync(legacy.manifest);
  // Synthetic migration fixture; this is not a product approval.
  fs.writeFileSync(path.join(old.runDir, 'review.json'), JSON.stringify({ status: 'approved', reviewDigest: old.reviewDigest }));
  expect(evidenceState(outDir()).publishable).toBe(true);
  const production = await runProduction(spec, opts());
  expect(evidenceState(outDir())).toMatchObject({ status: 'awaiting-approval', publishable: false });
  expect(production.metrics.executedProducers).toBe(1);
  expect(production.manifest).not.toBe(legacy.manifest);
  expect(fs.readFileSync(legacy.manifest)).toEqual(bytes);
  expect(fs.existsSync(path.join(old.runDir, 'raw/cli/result.txt'))).toBe(true);
  expect((await runProduction(spec, opts())).reusedCandidate).toBe(true);
  const projectBytes = fs.readFileSync(path.join(outDir(), PROJECT_FILE));
  expect((await captureEvidence(spec, opts())).machineStatus).toBe('publish-ready');
  expect(fs.readFileSync(path.join(outDir(), PROJECT_FILE))).toEqual(projectBytes);
  expect(count()).toBe(3);
});

test('CLI production retries honor the same attempt budget as legacy capture', async () => {
  const spec = config();
  spec.evidence.producers[0].command = [process.execPath, '-e', 'process.exit(7)'];
  fs.writeFileSync(path.join(cwd, 'take-a-repo.config.js'), `module.exports = ${JSON.stringify(spec)}`);
  let output = '';
  const io = { processCwd: () => cwd, stdout: { write: (s) => { output += s; } }, stderr: { write: () => {} } };
  expect(await runProductionCommand(['production', 'run', '--attempt', '3', '--json'], io)).toBe(1);
  expect(JSON.parse(output)).toMatchObject({ machineStatus: 'blocked', exitCode: 1 });
  for (const args of [['plan', '--attempt', '3'], ['run', '--attempt', '0'], ['run', '--attempt', '1.5'], ['run', '--attempt', 'Infinity']]) {
    output = '';
    expect(await runProductionCommand(['production', ...args, '--json'], io)).toBe(2);
  }
});

test('CLI emits one JSON object and rejects misplaced flags', async () => {
  fs.writeFileSync(path.join(cwd, 'take-a-repo.config.js'), `module.exports = ${JSON.stringify(config())}`);
  let stdout = ''; let stderr = '';
  const io = { processCwd: () => cwd, stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } };
  expect(await runProductionCommand(['production', 'run', '--json'], io)).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ ok: true, metrics: { executedProducers: 1 } });
  expect(stderr).toContain('collect cli');
  stdout = '';
  expect(await runProductionCommand(['production', 'plan', '--fresh', '--json'], io)).toBe(2);
  expect(JSON.parse(stdout)).toMatchObject({ ok: false, code: 2 });
});
