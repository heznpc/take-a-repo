const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  findFfmpeg,
  probeVideo,
  parseProbeOutput,
  buildFfmpegArgs,
  buildThumbnailArgs,
  buildVideoFilter,
  postProcessDemo,
  INSTALL_HINT,
} = require('../src/video');

describe('buildFfmpegArgs', () => {
  test('mp4 conversion defaults: libx264, yuv420p, faststart, silent, even-dims', () => {
    const args = buildFfmpegArgs({ input: 'in.webm', output: 'out.mp4' });
    expect(args).toEqual([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', 'in.webm',
      '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-movflags', '+faststart', '-an',
      'out.mp4',
    ]);
  });

  test('trim places -ss before -i (fast seek) and -t after', () => {
    const args = buildFfmpegArgs({ input: 'in.webm', output: 'out.mp4', trim: { start: 2, duration: '00:10' } });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('2');
    expect(args[args.indexOf('-t') + 1]).toBe('00:10');
  });

  test('custom crf is honored', () => {
    const args = buildFfmpegArgs({ input: 'a', output: 'b', crf: 18 });
    expect(args[args.indexOf('-crf') + 1]).toBe('18');
  });

  test('crop and zoom filters compose before the even-dimension scale', () => {
    const args = buildFfmpegArgs({
      input: 'a.webm',
      output: 'b.mp4',
      crop: { x: 10, y: 20, width: 1000, height: 600 },
      zoom: { scale: 1.25 },
    });
    expect(args[args.indexOf('-vf') + 1]).toBe(
      'crop=1000:600:10:20,crop=iw/1.25:ih/1.25:(iw-iw/1.25)/2:(ih-ih/1.25)/2,scale=ceil(iw*1.25/2)*2:ceil(ih*1.25/2)*2,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    );
  });

  test('copy mode stream-copies without encoder flags', () => {
    const args = buildFfmpegArgs({ input: 'a.webm', output: 'b.webm', trim: { duration: 5 }, copy: true });
    expect(args).toContain('-c');
    expect(args).not.toContain('libx264');
    expect(args).not.toContain('-movflags');
  });
});

describe('ffprobe metadata', () => {
  test('normalizes final codec, dimensions, pixel format, and duration', () => {
    expect(parseProbeOutput(JSON.stringify({
      streams: [{ codec_name: 'h264', pix_fmt: 'yuv420p', width: 1280, height: 720 }],
      format: { duration: '29.970000' },
    }))).toEqual({
      ok: true,
      codec: 'h264',
      pixelFormat: 'yuv420p',
      width: 1280,
      height: 720,
      durationSeconds: 29.97,
    });
  });

  test('rejects probe output without a video stream', () => {
    expect(() => parseProbeOutput('{"streams":[],"format":{}}')).toThrow(/no video stream/);
  });

  test('fails closed when metadata is readable but the full MP4 decode is corrupt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-probe-'));
    const ffprobe = path.join(dir, 'ffprobe');
    const ffmpeg = path.join(dir, 'ffmpeg');
    const video = path.join(dir, 'truncated.mp4');
    fs.writeFileSync(video, 'truncated');
    fs.writeFileSync(ffprobe, `#!/usr/bin/env node
if (process.argv.includes('-version')) {
  console.log('ffprobe version fake');
} else {
  console.log(JSON.stringify({
    streams: [{ codec_name: 'h264', pix_fmt: 'yuv420p', width: 720, height: 1280 }],
    format: { duration: '21.680000' },
  }));
}
`);
    fs.writeFileSync(ffmpeg, `#!/usr/bin/env node
if (process.argv.includes('-version')) {
  console.log('ffmpeg version fake');
  process.exit(0);
}
console.error('Invalid NAL unit: truncated input');
process.exit(183);
`);
    fs.chmodSync(ffprobe, 0o755);
    fs.chmodSync(ffmpeg, 0o755);

    expect(probeVideo(video, {
      TAKE_A_REPO_FFPROBE: ffprobe,
      TAKE_A_REPO_FFMPEG: ffmpeg,
      PATH: process.env.PATH,
    })).toMatchObject({
      ok: false,
      codec: 'h264',
      width: 720,
      height: 1280,
      error: expect.stringMatching(/failed full decode.*truncated input/i),
    });
  });

  test('accepts a final MP4 only after metadata and full decode both pass', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-probe-'));
    const ffprobe = path.join(dir, 'ffprobe');
    const ffmpeg = path.join(dir, 'ffmpeg');
    const video = path.join(dir, 'healthy.mp4');
    fs.writeFileSync(video, 'healthy');
    fs.writeFileSync(ffprobe, `#!/usr/bin/env node
if (process.argv.includes('-version')) console.log('ffprobe version fake');
else console.log('{"streams":[{"codec_name":"h264","pix_fmt":"yuv420p","width":1280,"height":720}],"format":{"duration":"30"}}');
`);
    fs.writeFileSync(ffmpeg, `#!/usr/bin/env node
if (process.argv.includes('-version')) console.log('ffmpeg version fake');
`);
    fs.chmodSync(ffprobe, 0o755);
    fs.chmodSync(ffmpeg, 0o755);

    expect(probeVideo(video, {
      TAKE_A_REPO_FFPROBE: ffprobe,
      TAKE_A_REPO_FFMPEG: ffmpeg,
      PATH: process.env.PATH,
    })).toMatchObject({
      ok: true,
      codec: 'h264',
      pixelFormat: 'yuv420p',
      width: 1280,
      height: 720,
      durationSeconds: 30,
    });
  });
});

describe('video filter helpers', () => {
  test('default filter only enforces even dimensions', () => {
    expect(buildVideoFilter()).toBe('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  });

  test('thumbnail args seek and write one png frame', () => {
    expect(buildThumbnailArgs({ input: 'demo.mp4', output: 'demo-thumbnail.png', at: 1.5 })).toEqual([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', '1.5',
      '-i', 'demo.mp4',
      '-frames:v', '1',
      'demo-thumbnail.png',
    ]);
  });
});

describe('findFfmpeg', () => {
  test('honors TAKE_A_REPO_FFMPEG when it looks like a real ffmpeg', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-ff-'));
    const fake = path.join(dir, 'fake-ffmpeg');
    fs.writeFileSync(fake, '#!/bin/sh\necho "ffmpeg version 7.0-test"\n');
    fs.chmodSync(fake, 0o755);
    expect(findFfmpeg({ TAKE_A_REPO_FFMPEG: fake, PATH: '' })).toBe(fake);
  });

  test('returns null when nothing usable exists', () => {
    expect(findFfmpeg({ TAKE_A_REPO_FFMPEG: '/nonexistent/ffmpeg', PATH: '/nonexistent' })).toBeNull();
  });

  test('install hint names the env override', () => {
    expect(INSTALL_HINT).toMatch(/TAKE_A_REPO_FFMPEG/);
  });
});

describe('postProcessDemo cleanup', () => {
  test('removes temp mp4 output when ffmpeg fails mid-encode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-postprocess-'));
    const fake = path.join(dir, 'fake-ffmpeg');
    const webmPath = path.join(dir, 'demo.webm');
    fs.writeFileSync(webmPath, 'webm');
    fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
if (process.argv.includes('-version')) {
  console.log('ffmpeg version fake');
  process.exit(0);
}
fs.writeFileSync(process.argv[process.argv.length - 1], 'partial');
process.exit(1);
`);
    fs.chmodSync(fake, 0o755);

    expect(() => postProcessDemo({
      webmPath,
      mp4: true,
      log: () => {},
      env: { TAKE_A_REPO_FFMPEG: fake, PATH: '' },
    })).toThrow();

    expect(fs.existsSync(path.join(dir, 'demo.mp4'))).toBe(false);
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });
});
