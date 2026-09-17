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
  // Compare opaque glyph pixels from the shared transparent overlay.
  // Excluding background and translucent edges tolerates composition and H.264
  // without allowing a large empty canvas to conceal missing words.
  for (let pixel = 0; pixel < expected.width * expected.height; pixel++) {
    const rgba = pixel * 4, rgb = pixel * 3;
    if (expected.data[rgba + 3] < 250) continue;
    pixels++;
    for (let channel = 0; channel < 3; channel++) error += Math.abs(expected.data[rgba + channel] - actual[rgb + channel]);
  }
  if (!pixels) throw new Error('caption QA reference contains no visible text');
  return error / (pixels * 3);
}

function verifyCaptionTrack({ bin, video, samples, width, height }) {
  const frameBytes = width * height * 3;
  const results = [];
  // Bound decoded memory independently of caption/word count.
  for (let offset = 0; offset < samples.length; offset += 8) {
    const batch = samples.slice(offset, offset + 8);
    const decoded = execFileSync(bin, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', video, '-an',
      '-vf', `select='${batch.map((sample) => `eq(n,${sample.frame})`).join('+')}'`, '-fps_mode', 'vfr', '-frames:v', String(batch.length),
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: ffmpegTimeoutMs(), killSignal: 'SIGKILL', maxBuffer: frameBytes * batch.length + 65536 });
    if (decoded.length !== frameBytes * batch.length) throw new Error('caption QA could not decode every requested word frame');
    batch.forEach((sample, index) => {
      const expected = PNG.sync.read(fs.readFileSync(sample.file));
      const actual = decoded.subarray(index * frameBytes, (index + 1) * frameBytes);
      const error = captionPixelError(expected, actual);
      if (error > 40) throw new Error(`caption ${sample.id} is missing or differs at frame ${sample.frame}`);
      results.push({ id: sample.id, frame: sample.frame, atSeconds: sample.frame / CAPTION_FPS, activeWordIndex: sample.activeWordIndex, meanPixelError: Math.round(error * 100) / 100 });
    });
  }
  return { ok: true, samples: results };
}
module.exports = { CAPTION_FPS, captionFrameNumbers, captionPixelError, verifyCaptionTrack };
