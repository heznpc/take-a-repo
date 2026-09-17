const fs = require('fs');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');
const { ffmpegTimeoutMs } = require('./video');

const CAPTION_FPS = 30;

function captionFrameNumbers(captions) {
  return captions.map((caption) => {
    const first = Math.ceil(caption.start * CAPTION_FPS - 1e-8);
    const last = Math.ceil(caption.end * CAPTION_FPS - 1e-8) - 1;
    if (first > last) throw new Error(`caption ${caption.id} has no output frame; lengthen its time range`);
    return Math.max(first, Math.min(last, Math.floor((caption.start + caption.end) * CAPTION_FPS / 2)));
  });
}

function captionPixelError(expected, actual) {
  if (actual.length !== expected.width * expected.height * 3) throw new Error('caption QA frame is missing or incomplete');
  let pixels = 0, error = 0;
  // The caption renderer owns a dark band and bright text. Compare the actual
  // glyph pixels with its PNG, allowing H.264 compression without letting the
  // much larger empty background conceal missing text in an average score.
  for (let pixel = 0; pixel < expected.width * expected.height; pixel++) {
    const rgba = pixel * 4, rgb = pixel * 3;
    if (Math.max(expected.data[rgba], expected.data[rgba + 1], expected.data[rgba + 2]) <= 128) continue;
    pixels++;
    for (let channel = 0; channel < 3; channel++) error += Math.abs(expected.data[rgba + channel] - actual[rgb + channel]);
  }
  if (!pixels) throw new Error('caption QA reference contains no visible text');
  return error / (pixels * 3);
}

function verifyCaptionFrames({ bin, video, overlays, captions, width, height, band }) {
  const frames = captionFrameNumbers(captions);
  const frameBytes = width * band * 3;
  const filter = `select='${frames.map((frame) => `eq(n,${frame})`).join('+')}',crop=${width}:${band}:0:${height - band}`;
  const decoded = execFileSync(bin, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', video, '-an',
    '-vf', filter, '-fps_mode', 'vfr', '-frames:v', String(frames.length),
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: ffmpegTimeoutMs(), killSignal: 'SIGKILL', maxBuffer: frameBytes * frames.length + 65536 });
  if (decoded.length !== frameBytes * frames.length) throw new Error('caption QA could not decode every requested output frame');
  const samples = captions.map((caption, i) => {
    const expected = PNG.sync.read(fs.readFileSync(overlays[i]));
    if (expected.width !== width || expected.height !== band) throw new Error('caption QA reference dimensions do not match');
    const error = captionPixelError(expected, decoded.subarray(i * frameBytes, (i + 1) * frameBytes));
    if (error > 40) throw new Error(`caption ${caption.id} is missing or differs from its rendered text in the output video`);
    return { id: caption.id, atSeconds: frames[i] / CAPTION_FPS, meanPixelError: Math.round(error * 100) / 100 };
  });
  return { ok: true, samples };
}

module.exports = { CAPTION_FPS, captionFrameNumbers, captionPixelError, verifyCaptionFrames };
