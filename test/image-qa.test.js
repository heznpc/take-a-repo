const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const { analyzePng } = require('../src/image-qa');

function writePng(fill) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-png-qa-'));
  const filePath = path.join(dir, 'frame.png');
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const offset = ((y * 32) + x) * 4;
      const [r, g, b, a] = fill(x, y);
      png.data[offset] = r;
      png.data[offset + 1] = g;
      png.data[offset + 2] = b;
      png.data[offset + 3] = a;
    }
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
  return filePath;
}

describe('thumbnail pixel QA', () => {
  test('flags a uniform black frame as blank', () => {
    const result = analyzePng(writePng(() => [0, 0, 0, 255]));
    expect(result).toMatchObject({ ok: true, nonBlank: false, width: 32, height: 32 });
  });

  test('accepts a visibly varied frame', () => {
    const result = analyzePng(writePng((x, y) => [x * 8, y * 8, (x + y) * 4, 255]));
    expect(result).toMatchObject({ ok: true, nonBlank: true, width: 32, height: 32 });
    expect(result.colorBuckets).toBeGreaterThan(8);
    expect(result.luminanceStdDev).toBeGreaterThan(3);
  });

  test('returns a structured failure for an invalid PNG', () => {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-png-qa-')), 'bad.png');
    fs.writeFileSync(filePath, 'not a png');
    expect(analyzePng(filePath)).toMatchObject({ ok: false, nonBlank: false });
  });
});
