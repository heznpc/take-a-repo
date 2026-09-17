const { captionFrameNumbers, captionPixelError } = require('../src/production-caption-qa');
const { validateEditorial } = require('../src/production-render');

test('caption samples stay within start-inclusive, end-exclusive output frame intervals', () => {
  expect(captionFrameNumbers([
    { id: 'short', start: 0.2, end: 0.8 },
    { id: 'one-frame', start: 1, end: 1 + 1 / 30 },
    { id: 'fractional', start: 2.01, end: 2.04 },
  ])).toEqual([15, 30, 61]);
  expect(() => validateEditorial({ id: 'demo', captions: [{ id: 'invisible', start: 0.01, end: 0.02, text: 'No output frame' }] })).toThrow(/no output frame/);
});

test('pixel QA measures glyphs even when the missing caption is a tiny fraction of the band', () => {
  const expected = { width: 100, height: 10, data: Buffer.alloc(100 * 10 * 4, 20) };
  expected.data.set([255, 255, 255, 255], 200);
  const absent = Buffer.alloc(100 * 10 * 3, 20);
  const present = Buffer.from(absent);
  present.set([250, 251, 249], 150);
  expect(captionPixelError(expected, present)).toBeLessThan(10);
  expect(captionPixelError(expected, absent)).toBeGreaterThan(200);
  expect(() => captionPixelError(expected, Buffer.alloc(0))).toThrow(/missing or incomplete/);
  expected.data.fill(20);
  expect(() => captionPixelError(expected, absent)).toThrow(/no visible text/);
});

test('production inherits Shorts focus and rejects unreadable intervals and unknown style fields', () => {
  const { resolvedCaptionOptions } = require('../src/production-render');
  expect(resolvedCaptionOptions({ channel: 'youtube-shorts' })).toMatchObject({ mode: 'focus', appearance: 'outline', wordsPerChunk: 3, bottomOffset: 380 });
  expect(() => validateEditorial({ id: 'demo', channel: 'youtube-shorts', captions: [{ id: 'blink', start: 0, end: 1 / 30, text: 'Read these seven words before they disappear' }] })).toThrow('dense-caption');
  expect(() => validateEditorial({ id: 'demo', captionOptions: { mode: 'wrong' } })).toThrow();
  expect(() => validateEditorial({ id: 'demo', captionOptions: { activeColour: 'red' } })).toThrow('unsupported');
});

test.each([false, 0, 'focus'])('invalid editorial containers fail instead of silently clearing captions (%p)', (value) => {
  expect(() => validateEditorial({ id: 'demo', captions: value })).toThrow('captions must be an array');
  expect(() => validateEditorial({ id: 'demo', captionOptions: value })).toThrow('captionOptions must be an object');
});
