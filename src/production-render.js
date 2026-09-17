const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Ajv = require('ajv');
const { chromium } = require('playwright');
const { findFfmpeg, ffmpegTimeoutMs } = require('./video');
const { resolveChannelProfile } = require('./channels');
const { measureAsset } = require('./evidence-contract');
const { renderDeliverable } = require('./evidence-render');
const { normalizeTypographyOptions, prepareCaptionTypography } = require('./caption-typography');

const projectSchema = require('../schemas/production-project.schema.json');
const validateCaption = new Ajv({ allErrors: true }).compile(projectSchema.definitions.caption);
const validateTrim = new Ajv({ allErrors: true }).compile(projectSchema.definitions.trim);

function validateEditorial(spec) {
  if (spec.trim && !validateTrim(spec.trim)) throw new Error(`${spec.id}: invalid trim`);
  const captions = spec.captions || [];
  if (!Array.isArray(captions) || captions.length > 40) throw new Error('captions must be an array of at most 40 entries');
  const typography = normalizeTypographyOptions(spec.captionOptions);
  const minFontSize = Math.max(typography.minFontSize, 20);
  const maxFontSize = Math.min(typography.maxFontSize || 42, 42);
  if (captions.length && minFontSize > maxFontSize) throw new Error(`${spec.id}: incompatible typography bounds for the caption band`);
  if (captions.some((caption) => /\P{ASCII}/u.test(caption?.text || ''))
    && (typography.locale === 'und' || !typography.fonts.length)) {
    throw new Error(`${spec.id}: localized captions require captionOptions.typography.locale and project-local fonts`);
  }
  const ids = new Set();
  let lastEnd = 0;
  for (const caption of captions) {
    if (!validateCaption(caption) || !caption.text.trim() || ids.has(caption.id)
      || caption.end <= caption.start || caption.start < lastEnd) {
      throw new Error(`${spec.id}: captions need unique IDs, nonempty text and ordered non-overlapping time ranges`);
    }
    if (caption.fontSize != null && (caption.fontSize < minFontSize || caption.fontSize > maxFontSize)) {
      throw new Error(`${spec.id}: caption fontSize is outside declared typography bounds`);
    }
    ids.add(caption.id);
    lastEnd = caption.end;
  }
}

async function captionImages(captions, width, height, dir, captionOptions, cwd) {
  const prepared = await prepareCaptionTypography(captionOptions, cwd, captions.map((c) => c.text));
  if (prepared.report.missingGlyphs?.length) throw new Error('caption font is missing authored glyphs');
  const typography = normalizeTypographyOptions(captionOptions);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#14151a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;padding:12px 32px}p{margin:0;width:100%;text-align:center;font-family:Arial,sans-serif;font-weight:600;line-height:1.25;overflow-wrap:anywhere;white-space:pre-wrap}</style><p></p>');
    await page.evaluate(async ({ faces, style }) => {
      for (const face of faces) {
        const font = new FontFace(face.family, `url(${face.source})`, { weight: face.weight, style: face.style });
        document.fonts.add(await font.load());
        if (font.status !== 'loaded') throw new Error(`caption font failed to load: ${face.family}`);
      }
      document.documentElement.lang = style.locale;
      document.documentElement.dir = style.direction;
      const element = document.querySelector('p');
      element.style.fontFamily = style.family;
      if (style.weight) element.style.fontWeight = style.weight;
      await document.fonts.ready;
    }, { faces: prepared.runtimeOptions.typography?.fontFaces || [], style: typography });
    const files = [];
    for (const caption of captions) {
      const metrics = await page.evaluate(({ text, fontSize, style, bandHeight }) => {
        const element = document.querySelector('p');
        element.textContent = text;
        const lowerBound = Math.max(style.minFontSize, 20);
        const max = Math.min(style.maxFontSize || 42, 42);
        let size = fontSize || Math.max(lowerBound, Math.min(28, max));
        const min = style.enabled && style.fit === 'shrink' ? lowerBound : size;
        if (size < lowerBound || size > max) throw new Error('caption fontSize is outside declared typography bounds');
        let measurement;
        do {
          element.style.fontSize = `${size--}px`;
          const rect = element.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
          measurement = { top: rect.top, bottom: rect.bottom, lines: Math.round(rect.height / lineHeight), width: element.scrollWidth, available: rect.width };
          if (measurement.lines <= Math.min(style.maxLines, 2) && measurement.top >= 10 && measurement.bottom <= bandHeight - 10 && measurement.width <= rect.width + 1) break;
        } while (size >= min);
        return measurement;
      }, { ...caption, style: typography, bandHeight: height });
      if (metrics.top < 10 || metrics.bottom > height - 10 || metrics.lines > Math.min(typography.maxLines, 2) || metrics.width > metrics.available + 1) {
        throw new Error(`caption ${caption.id} does not fit the two-line band; shorten it or reduce fontSize`);
      }
      const file = path.join(dir, `${caption.id}.png`);
      await page.screenshot({ path: file });
      files.push(file);
    }
    return files;
  } finally { await browser.close(); }
}

async function renderProductionDeliverable(spec, report, runDir, cwd = process.cwd()) {
  if (spec.kind !== 'video') return renderDeliverable(spec, report, runDir);
  validateEditorial(spec);
  const [producerId, assetId] = spec.source.split(':');
  const input = report.producers.find((p) => p.id === producerId)?.assets.find((a) => a.id === assetId);
  if (!input || !input.mediaType.startsWith('video/')) throw new Error(`video source missing: ${spec.source}`);
  const start = spec.trim?.start || 0;
  const duration = spec.trim?.duration || input.qa.durationSeconds;
  if (!(duration > 0) || start + duration > input.qa.durationSeconds + 0.05) throw new Error(`${spec.id}: requested source interval is unavailable; recapture this scene`);
  const captions = spec.captions || [];
  if (captions.some((caption) => caption.end > duration)) throw new Error(`${spec.id}: caption extends past the edited video`);
  if (!captions.length) return renderDeliverable(spec, report, runDir);
  if (spec.fit !== 'contain') throw new Error('production video requires fit: contain');
  const profile = resolveChannelProfile(spec.channel);
  const { width, height } = profile.viewport;
  const band = 112;
  const dir = path.join(runDir, 'deliverables', `${spec.id}-captions`);
  fs.mkdirSync(dir, { recursive: true });
  const overlays = await captionImages(captions, width, band, dir, spec.captionOptions, cwd);
  const bin = findFfmpeg();
  if (!bin) throw new Error('production rendering needs ffmpeg');
  const video = path.join(runDir, 'deliverables', `${spec.id}.mp4`);
  const poster = path.join(runDir, 'deliverables', `${spec.id}.png`);
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path.join(runDir, input.path)];
  for (const overlay of overlays) args.push('-loop', '1', '-i', overlay);
  const filters = [`[0:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,scale=${width}:${height - band}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(${width}-iw)/2:(${height - band}-ih)/2,setsar=1[v0]`];
  captions.forEach((caption, i) => filters.push(`[v${i}][${i + 1}:v]overlay=0:${height - band}:enable='gte(t,${caption.start})*lt(t,${caption.end})'[v${i + 1}]`));
  args.push('-filter_complex', filters.join(';'), '-map', `[v${captions.length}]`, '-an', '-t', String(duration), '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video);
  const options = { stdio: ['ignore', 'ignore', 'pipe'], timeout: ffmpegTimeoutMs(), killSignal: 'SIGKILL' };
  execFileSync(bin, args, options);
  const measured = measureAsset(runDir, { id: spec.id, path: path.relative(runDir, video), mediaType: 'video/mp4', role: 'recording' });
  const qa = measured.qa;
  if (qa.codec !== 'h264' || qa.pixelFormat !== 'yuv420p' || qa.width !== width || qa.height !== height
    || qa.durationSeconds < profile.recommendedDurationSeconds.min || qa.durationSeconds > profile.recommendedDurationSeconds.max) {
    throw new Error(`production channel QA failed for ${spec.id}`);
  }
  execFileSync(bin, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', video, '-frames:v', '1', poster], options);
  return [measured,
    measureAsset(runDir, { id: `${spec.id}-poster`, path: path.relative(runDir, poster), mediaType: 'image/png', role: 'screenshot' }),
    ...overlays.map((file, i) => measureAsset(runDir, { id: `${spec.id}-caption-${i}`, path: path.relative(runDir, file), mediaType: 'image/png', role: 'editorial-caption' })),
  ];
}

module.exports = { validateEditorial, renderProductionDeliverable };
