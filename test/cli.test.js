const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, resolveConfigPath, USAGE } = require('../src/cli');

const BIN = path.resolve(__dirname, '..', 'bin', 'take-a-repo.js');

describe('parseArgs', () => {
  test('defaults', () => {
    expect(parseArgs([])).toMatchObject({
      scenes: [], targets: [], errors: [], json: false, noVideo: false,
      campaign: false, calibrate: false, port: null, open: true, help: false, path: null,
    });
  });

  test('positional path + flags', () => {
    const o = parseArgs(['../my-ext', '--json', '--no-video']);
    expect(o.path).toBe('../my-ext');
    expect(o.json).toBe(true);
    expect(o.noVideo).toBe(true);
  });

  test('--scene accepts comma lists and repeats', () => {
    expect(parseArgs(['--scene', 'a,b', '--scene', 'c']).scenes).toEqual(['a', 'b', 'c']);
    expect(parseArgs(['--scene=a,b']).scenes).toEqual(['a', 'b']);
  });

  test('--target accepts comma lists and repeats', () => {
    expect(parseArgs(['--target', 'x,cws-youtube', '--target', 'youtube-shorts']).targets)
      .toEqual(['x', 'cws-youtube', 'youtube-shorts']);
    expect(parseArgs(['--target=x']).targets).toEqual(['x']);
  });

  test('--attempt accepts positive integers for agent retries', () => {
    expect(parseArgs(['--attempt', '2']).attempt).toBe(2);
    expect(parseArgs(['--attempt=3']).attempt).toBe(3);
    expect(parseArgs(['--attempt', '0']).errors).toEqual(['--attempt requires a positive integer']);
  });

  test('--calibrate accepts local server controls', () => {
    expect(parseArgs(['--calibrate', '--port', '4312', '--no-open'])).toMatchObject({
      calibrate: true,
      port: 4312,
      open: false,
    });
    expect(parseArgs(['--port=65536']).errors).toEqual(['--port requires an integer between 0 and 65535']);
  });

  test('--campaign is additive and cannot be combined with --calibrate', () => {
    expect(parseArgs(['--campaign', '--port', '4312', '--no-open'])).toMatchObject({
      campaign: true,
      calibrate: false,
      port: 4312,
      open: false,
    });
    expect(parseArgs(['--campaign', '--calibrate']).errors)
      .toEqual(['--campaign and --calibrate cannot be used together']);
  });

  test('usage errors are explicit for missing values and unknown options', () => {
    expect(parseArgs(['--scene']).errors).toEqual(['--scene requires a scene name']);
    expect(parseArgs(['--scene=']).errors).toEqual(['--scene requires a scene name']);
    expect(parseArgs(['--config', '--json']).errors).toEqual(['--config requires a config path']);
    expect(parseArgs(['--config=']).errors).toEqual(['--config requires a config path']);
    expect(parseArgs(['--target']).errors).toEqual(['--target requires a channel target']);
    expect(parseArgs(['--target=']).errors).toEqual(['--target requires a channel target']);
    expect(parseArgs(['--attempt=oops']).errors).toEqual(['--attempt requires a positive integer']);
    expect(parseArgs(['--port=oops']).errors).toEqual(['--port requires an integer between 0 and 65535']);
    expect(parseArgs(['--wat']).errors).toEqual(['unknown option: --wat']);
  });

  test('--config consumes its value (not mistaken for the positional)', () => {
    const o = parseArgs(['--config', 'x.js', 'repo']);
    expect(o.config).toBe('x.js');
    expect(o.path).toBe('repo');

    const inline = parseArgs(['--config=x.js', 'repo']);
    expect(inline.config).toBe('x.js');
    expect(inline.path).toBe('repo');
  });

  test('only one positional path is accepted', () => {
    const opts = parseArgs(['a', 'b']);
    expect(opts.path).toBe('a');
    expect(opts.errors).toEqual(['unexpected positional argument: b']);
  });

  test('USAGE documents the agent contract', () => {
    expect(USAGE).toContain('--json');
    expect(USAGE).toContain('--campaign');
    expect(USAGE).toContain('--calibrate');
    expect(USAGE).toContain('Exit codes');
  });
});

describe('take-a-repo CLI usage errors', () => {
  function run(args) {
    return spawnSync(process.execPath, [BIN, ...args], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
    });
  }

  test('unknown flags and flag typos fail before config resolution', () => {
    const res = run(['--no-buid']);

    expect(res.status).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('unknown option: --no-buid');
    expect(res.stderr).toContain('Usage: take-a-repo');
  });

  test('missing option values fail with usage code 2', () => {
    const res = run(['--scene']);

    expect(res.status).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('--scene requires a scene name');
    expect(res.stderr).toContain('Usage: take-a-repo');
  });

  test('--json usage errors write one JSON object to stdout', () => {
    const res = run(['--config', '--json']);

    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: false,
      error: '--config requires a config path',
      code: 2,
    });
    expect(res.stderr).toBe('');
  });

  test('--json unknown scenes fail with usage code 2 before capture work', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-cli-scene-'));
    fs.writeFileSync(path.join(dir, 'take-a-repo.config.js'), `
module.exports = {
  prepareExtension() { throw new Error('prepareExtension should not run'); },
  scenes: [{ name: 'known-scene', run: async () => {} }],
};
`);

    const res = spawnSync(process.execPath, [BIN, dir, '--scene', 'missing-scene', '--json', '--no-build', '--no-video'], {
      encoding: 'utf8',
    });

    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: false,
      error: 'unknown scene: missing-scene. Known: known-scene',
      code: 2,
    });
    expect(res.stderr).toBe('');
  });
});

describe('resolveConfigPath', () => {
  test('uses only take-a-repo.config.js by default', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-cli-'));
    expect(resolveConfigPath(null, dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'store.config.js'), 'module.exports={}');
    expect(resolveConfigPath(null, dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'take-a-repo.config.js'), 'module.exports={}');
    expect(resolveConfigPath(null, dir)).toBe(path.join(dir, 'take-a-repo.config.js'));
  });

  test('explicit --config resolves against the target dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-cli-'));
    expect(resolveConfigPath('custom.js', dir)).toBe(path.resolve(dir, 'custom.js'));
  });
});
