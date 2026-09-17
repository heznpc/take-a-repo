const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { ensureDemoCaptionOverlay } = require('./demo');
const { prepareCaptionTypography } = require('./caption-typography');
const { buildCaptionFrames, buildCaptionTimeline } = require('./demo-caption-focus');
const { analyzeDemoCaptionMetrics } = require('./demo-caption-qa');
const { CAPTION_FPS } = require('./production-caption-qa');

const frameAt = (seconds) => Math.ceil(seconds * CAPTION_FPS - 1e-8);

function captionSchedule(captions) {
  // A hide event closes each authored interval, including the last caption.
  return captions.flatMap((caption) => [{ atMs: caption.start * 1000, text: caption.text }, { atMs: caption.end * 1000, text: '' }]);
}

async function renderCaptionTrack({ captions, options, viewport, duration, directory, cwd, protectedRegions = [] }) {
  const prepared = await prepareCaptionTypography(options, cwd, captions.map((c) => c.text));
  if (prepared.report.missingGlyphs?.length) throw new Error('caption font is missing authored glyphs');
  const frames = buildCaptionFrames(captionSchedule(captions), options);
  const timeline = buildCaptionTimeline(frames, { endMs: duration * 1000 });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  fs.mkdirSync(directory, { recursive: true });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body></body></html>');
    await ensureDemoCaptionOverlay(page, prepared.runtimeOptions);
    // Freeze the root transition, but sample the shared word-pop keyframes at
    // exact output times. Wall-clock/screenshot latency never sets video timing.
    await page.addStyleTag({ content: '#__take-a-repo_demo_caption__{transition:none!important} .take-a-repo-caption-word{animation-play-state:paused!important}' });
    if (!await page.evaluate((color) => CSS.supports('color', color), options.activeColor || '#facc15')) throw new Error('invalid caption activeColor');
    const blank = path.join(directory, 'blank.png');
    fs.writeFileSync(blank, PNG.sync.write(new PNG({ ...viewport })));
    const totalFrames = frameAt(duration);
    const spans = [], samples = [], metrics = [];
    let cursor = 0, serial = 0;
    const append = (file, start, end) => { if (end > start) spans.push({ file, start, end }); };
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (!frame.text) continue;
      const start = frameAt(frame.atMs / 1000);
      const end = Math.min(totalFrames, frameAt((frames[i + 1]?.atMs ?? duration * 1000) / 1000));
      if (end <= start) continue;
      append(blank, cursor, start);
      const caption = captions.find((c) => c.start * 1000 === frame.sourceAtMs);
      const frameOptions = { ...prepared.runtimeOptions, ...options, ...frame.options,
        // Prepared font faces stay on the overlay's base typography.
        ...(caption?.fontSize ? { fontSize: caption.fontSize } : {}) };
      const measured = await page.evaluate(({ text, style }) => window.__takeARepoDemoCaption.show(text, style), { text: frame.text, style: frameOptions });
      metrics.push({ ...measured, expectedAtMs: frame.atMs, actualAtMs: frame.atMs });
      const animationMs = await page.evaluate(() => {
        const root = document.getElementById('__take-a-repo_demo_caption__');
        return Math.max(0, ...root.getAnimations({ subtree: true }).map((animation) => {
          animation.pause(); animation.currentTime = 0;
          return Number(animation.effect.getTiming().duration) || 0;
        }));
      });
      const movingFrames = Math.min(end - start - 1, Math.ceil(animationMs * CAPTION_FPS / 1000));
      for (let offset = 0; offset <= movingFrames; offset++) {
        await page.evaluate((ms) => {
          for (const animation of document.getElementById('__take-a-repo_demo_caption__').getAnimations({ subtree: true })) {
            animation.pause(); animation.currentTime = ms;
          }
        }, offset * 1000 / CAPTION_FPS);
        const file = path.join(directory, `frame-${String(serial++).padStart(5, '0')}.png`);
        await page.screenshot({ path: file, omitBackground: true, animations: 'allow' });
        const at = start + offset;
        const until = offset === movingFrames ? end : at + 1;
        append(file, at, until);
        // Check every word state and both the pop and settled image in the MP4.
        if (offset === Math.min(movingFrames, Math.ceil(animationMs * 0.7 * CAPTION_FPS / 1000)) || offset === movingFrames) samples.push({ id: caption.id, frame: at, file, activeWordIndex: frame.options.activeWordIndex ?? null });
      }
      cursor = end;
    }
    append(blank, cursor, totalFrames);
    const warnings = analyzeDemoCaptionMetrics({ expectedFrames: frames, samples: metrics, typography: prepared.report }, { viewport, protectedRegions });
    if (warnings.length) throw new Error(warnings.map((warning) => `${warning.code}: ${warning.message}; ${warning.fix}`).join('\n'));
    const concat = path.join(directory, 'track.ffconcat');
    fs.writeFileSync(concat, 'ffconcat version 1.0\n' + spans.map((span) => `file '${path.basename(span.file)}'\noption framerate ${CAPTION_FPS}\nduration ${(span.end - span.start) / CAPTION_FPS}\n`).join('') + `file '${path.basename(spans.at(-1).file)}'\noption framerate ${CAPTION_FPS}\n`);
    return { concat, samples, timeline, metrics, style: options };
  } finally { await browser.close(); }
}

module.exports = { captionSchedule, renderCaptionTrack };
