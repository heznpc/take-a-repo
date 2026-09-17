const fs = require('fs');
const os = require('os');
const path = require('path');
jest.mock('../src/evidence-render', () => ({ renderDeliverable: jest.fn(() => []) }));
jest.mock('playwright', () => ({ chromium: { launch: jest.fn(async () => { throw new Error('caption-renderer-reached'); }) } }));
const { chromium } = require('playwright');
const { renderProductionDeliverable } = require('../src/production-render');
const { renderDeliverable } = require('../src/evidence-render');
const { readEvidence } = require('../src/evidence-contract');

let directory;
const spec = { id: 'demo', kind: 'video', source: 'capture:video', channel: 'x', fit: 'contain', captions: [{ id: 'intro', start: 0, end: 3, text: 'Updated caption' }] };
const report = (captionState) => ({ producers: [{ id: 'capture', assets: [{ id: 'video', path: 'raw.mp4', mediaType: 'video/mp4', qa: { durationSeconds: 24 }, ...(captionState === undefined ? {} : { captionState }) }] }] });
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-caption-source-')); jest.clearAllMocks(); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

test.each(['burned-in', 'unknown', undefined])('blocks new captions on %s footage before Chromium or FFmpeg work', async (state) => {
  await expect(renderProductionDeliverable(spec, report(state), directory)).rejects.toThrow(/uncaptioned master/);
  expect(chromium.launch).not.toHaveBeenCalled();
  expect(renderDeliverable).not.toHaveBeenCalled();
  expect(fs.readdirSync(directory)).toEqual([]);
});

test('a declared clean master reaches the caption renderer', async () => {
  await expect(renderProductionDeliverable(spec, report('none'), directory)).rejects.toThrow('caption-renderer-reached');
  expect(chromium.launch).toHaveBeenCalledTimes(1);
});

test('unchanged legacy footage remains renderable without adding captions', async () => {
  await renderProductionDeliverable({ ...spec, captions: [] }, report(), directory);
  expect(renderDeliverable).toHaveBeenCalledTimes(1);
  expect(chromium.launch).not.toHaveBeenCalled();
});

test('producer evidence accepts only declared caption states and keeps legacy inputs valid', () => {
  const file = path.join(directory, 'evidence.json');
  for (const state of ['none', 'burned-in', 'unknown', undefined, 'clean-enough']) {
    const asset = { id: 'video', path: 'video.mp4', mediaType: 'video/mp4', role: 'recording' };
    if (state !== undefined) asset.captionState = state;
    fs.writeFileSync(file, JSON.stringify({ version: 1, assets: [asset], checks: [] }));
    if (state === 'clean-enough') expect(() => readEvidence(file)).toThrow(/invalid producer evidence/);
    else expect(readEvidence(file).assets[0].captionState).toBe(state);
  }
});
