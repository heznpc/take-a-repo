const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PNG } = require('pngjs');
const { findFfmpeg, ffmpegTimeoutMs } = require('./video');
const { digest } = require('./evidence-contract');
const { sha256File } = require('./handoff-files');

function observationTool() {
  const bin = findFfmpeg();
  if (!bin) throw new Error('production observe requires ffmpeg');
  const result = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error('cannot identify observation ffmpeg');
  return { bin, fingerprint: digest(result.stdout) };
}

function extractObservationFrames(source, directory, recipe, tool) {
  // Keep actual presentation timestamps, including variable-frame-rate input.
  // Sampling is bounded; it does not claim to detect every event or scene cut.
  const filter = `setpts=PTS-STARTPTS,select='isnan(prev_selected_t)+gte(t-prev_selected_t,${recipe.intervalSeconds})',scale=w='min(${recipe.width},iw)':h='min(${recipe.width},ih)':force_original_aspect_ratio=decrease,showinfo`;
  const result = spawnSync(tool.bin, [
    '-hide_banner', '-nostdin', '-i', source, '-map', '0:v:0', '-an',
    '-vf', filter, '-fps_mode', 'vfr', '-frames:v', String(recipe.maxFrames),
    path.join(directory, 'frame-%04d.png'),
  ], { encoding: 'utf8', timeout: ffmpegTimeoutMs(), maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
  if (result.status !== 0) throw new Error(`observation extraction failed: ${result.error?.message || result.stderr?.slice(-2000)}`);
  const timestamps = [...result.stderr.matchAll(/\bn:\s*\d+\s+pts:\s*\S+\s+pts_time:\s*([\d.eE+-]+)/g)].map((match) => Number(match[1]));
  const files = fs.readdirSync(directory).filter((file) => /^frame-\d+\.png$/.test(file)).sort();
  if (!files.length || files.length > recipe.maxFrames || timestamps.length < files.length) throw new Error('observation frames or timestamps are missing');
  return files.map((file, i) => {
    const target = path.join(directory, file);
    const png = PNG.sync.read(fs.readFileSync(target));
    return { atSeconds: timestamps[i], path: file, sha256: sha256File(target), bytes: fs.statSync(target).size, width: png.width, height: png.height };
  });
}

module.exports = { observationTool, extractObservationFrames };
