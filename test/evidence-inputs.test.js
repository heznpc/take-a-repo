const fs = require('fs');
const os = require('os');
const path = require('path');
const { fingerprintInputs } = require('../src/evidence-inputs');
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-inputs-')); fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/a.js'), 'a'); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
test('changed bytes, new untracked files and deletion invalidate the input digest', () => {
  const hash = () => fingerprintInputs(root, ['src']).digest;
  const initial = hash();
  fs.writeFileSync(path.join(root, 'src/a.js'), 'b');
  expect(hash()).not.toBe(initial);
  fs.writeFileSync(path.join(root, 'src/a.js'), 'a');
  expect(hash()).toBe(initial);
  fs.writeFileSync(path.join(root, 'src/new.js'), 'new');
  expect(hash()).not.toBe(initial);
  fs.unlinkSync(path.join(root, 'src/a.js'));
  expect(hash()).not.toBe(initial);
});
test('missing paths, escapes and symlinks fail closed', () => {
  expect(() => fingerprintInputs(root, ['missing'])).toThrow();
  expect(() => fingerprintInputs(root, ['../outside'])).toThrow();
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
  expect(() => fingerprintInputs(root, ['link'])).toThrow(/symlink/);
});
