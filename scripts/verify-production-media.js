// Integration regression: requires installed Chromium and real FFmpeg/FFprobe.
// All evidence and media are synthetic fixtures in an isolated temporary root.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { runProduction, planProduction, editProduction } = require('../src/production');
const { observeProduction, productionContext } = require('../src/production-observe');
const { evidenceState } = require('../src/evidence-state');
const { verifyCaptionFrames } = require('../src/production-caption-qa');
const { createDemoController, installDemoCaptionOverlay } = require('../src/demo');
const { analyzeDemoCaptionMetrics } = require('../src/demo-caption-qa');
const { findFfmpeg, ffmpegTimeoutMs } = require('../src/video');

async function main() {
  const bin = findFfmpeg();
  assert.ok(bin, 'real FFmpeg is required');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-media-regression-'));
  const ffmpeg = (args) => execFileSync(bin, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: ffmpegTimeoutMs(), killSignal: 'SIGKILL',
  });
  try {
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=1:d=21', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(cwd, 'source.mp4')]);
    fs.writeFileSync(path.join(cwd, 'collect.js'), `
const fs = require('fs'), path = require('path'), out = process.env.TAKE_A_REPO_OUTPUT_DIR;
fs.appendFileSync('executions', 'x');
fs.copyFileSync('source.mp4', path.join(out, 'source.mp4'));
fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify({ version: 1,
  assets: [{ id: 'video', path: 'source.mp4', mediaType: 'video/mp4', role: 'recording', captionState: 'none' }],
  checks: [{ id: 'recorded', status: 'pass', summary: 'Synthetic regression recording', assets: ['video'] }]
}));
`);
    const config = { outDir: 'evidence', evidence: { version: 1,
      producers: [{ id: 'fixture', kind: 'cli', command: [process.execPath, 'collect.js'],
        reuse: { mode: 'local-inputs', inputs: ['collect.js', 'source.mp4'], maxAgeSeconds: 3600 } }],
      claims: [{ id: 'recorded', text: 'Synthetic source recorded', checks: ['fixture:recorded'] }],
      deliverables: [{ id: 'demo', kind: 'video', source: 'fixture:video', channel: 'x', fit: 'contain', claims: ['recorded'],
        captions: [{ id: 'intro', start: 0, end: 3, text: 'W'.repeat(240), fontSize: 42 }] }],
    } };
    const opts = { cwd, log: () => {} };
    const first = await runProduction(config, opts);
    assert.equal(first.machineStatus, 'needs-fix');
    assert.equal(evidenceState(first.outDir).publishable, false);
    assert.match(JSON.parse(fs.readFileSync(first.manifest)).deliverables[0].error, /does not fit/);
    assert.equal(planProduction(config, opts).producers[0].action, 'reuse');
    await observeProduction(config, opts);
    assert.equal(productionContext(config, { ...opts, maxFrames: 2 }).frames.length, 2);

    const captions = [
      { id: 'intro', start: 0.2, end: 0.8, text: 'Visible between source frames' },
      { id: 'next', start: 1.2, end: 2.8, text: 'A second independent caption' },
    ];
    await editProduction(config, { baseRevision: 1, operations: [{ deliverable: 'demo', set: { captions } }] }, opts);
    const repaired = await runProduction(config, opts);
    assert.equal(repaired.machineStatus, 'publish-ready', fs.readFileSync(repaired.manifest, 'utf8'));
    assert.equal(repaired.metrics.executedProducers, 0);
    assert.equal(repaired.metrics.reusedProducers, 1);
    assert.equal(fs.readFileSync(path.join(cwd, 'executions'), 'utf8'), 'x');
    assert.equal(evidenceState(repaired.outDir).publishable, false);
    const runDir = path.dirname(repaired.manifest);
    const report = JSON.parse(fs.readFileSync(repaired.manifest));
    const measured = report.files.find((asset) => asset.id === 'demo');
    assert.equal(measured.qa.captions.samples.length, 2);
    const video = path.join(runDir, measured.path);
    const overlays = captions.map((caption) => path.join(runDir, 'deliverables/demo-captions', `${caption.id}.png`));
    const sampleBand = (at) => ffmpeg(['-ss', String(at), '-i', video, '-vf', 'crop=1280:112:0:608', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    assert.ok(sampleBand(0.4).some((value) => value > 200), 'the short caption must appear');
    assert.ok(sampleBand(1).every((value) => value < 40), 'the caption must disappear between intervals');
    assert.ok(sampleBand(2).some((value) => value > 200), 'the second caption must appear');

    const missingVideo = path.join(cwd, 'missing-captions.mp4');
    ffmpeg(['-i', video, '-vf', 'drawbox=x=0:y=608:w=1280:h=112:color=black:t=fill', '-an', '-c:v', 'libx264', missingVideo]);
    assert.throws(() => verifyCaptionFrames({ bin, video: missingVideo, overlays, captions, width: 1280, height: 720, band: 112 }), /missing or differs/);

    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
      const context = await browser.newContext();
      await installDemoCaptionOverlay(context);
      const page = await context.newPage();
      await page.setContent('<p>Scheduled caption visibility fixture</p>');
      const demo = createDemoController({ page, captions: [{ at: 0.1, text: 'Visible caption' }, { at: 0.4, text: '' }] });
      try {
        await page.waitForTimeout(650);
        assert.equal(await page.locator('#__take-a-repo_demo_caption__').getAttribute('data-visible'), 'false');
        assert.ok(demo.captionMetrics().samples.length > 0);
        assert.deepEqual(analyzeDemoCaptionMetrics(demo.captionMetrics()), []);
      } finally { demo.stop(); }
    } finally { await browser.close(); }
    console.log(JSON.stringify({ ok: true, checks: ['low-fps caption timing', 'decoded caption presence', 'first-render source reuse', 'failed-render observations', 'approval remains required', 'scheduled hide'], captionQA: measured.qa.captions }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
