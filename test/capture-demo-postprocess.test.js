const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/launch', () => {
  const mockFs = require('fs');

  function makePage() {
    let closed = false;
    return {
      setViewportSize: jest.fn(async () => {}),
      on: jest.fn(),
      off: jest.fn(),
      waitForTimeout: jest.fn(async () => {}),
      evaluate: jest.fn(async () => {}),
      video: jest.fn(() => ({
        saveAs: jest.fn(async (out) => {
          mockFs.writeFileSync(out, 'webm');
        }),
      })),
      close: jest.fn(async () => {
        closed = true;
      }),
      isClosed: jest.fn(() => closed),
    };
  }

  return {
    launchBrowser: jest.fn(async () => ({
      extensionId: 'test-extension',
      context: {
        addInitScript: jest.fn(async () => {}),
        newPage: jest.fn(async () => makePage()),
      },
    })),
    closeContext: jest.fn(async () => {}),
  };
});

jest.mock('../src/video', () => ({
  postProcessDemo: jest.fn(() => {
    throw new Error('ffmpeg unavailable');
  }),
}));

const { capture } = require('../src/capture');
const { postProcessDemo } = require('../src/video');

test('capture fails when requested demo post-processing fails', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-demo-postprocess-'));
  const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-extension-'));
  const logs = [];

  await expect(capture({
    outDir: 'store-assets',
    prepareExtension: async () => extensionDir,
    demos: [{
      name: 'demo',
      mp4: true,
      run: async () => {},
    }],
  }, {
    cwd,
    noBuild: true,
    log: (msg) => logs.push(msg),
  })).rejects.toThrow(/demo "demo" post-processing failed: ffmpeg unavailable/);

  const webmPath = path.join(cwd, 'store-assets', 'demo.webm');
  expect(postProcessDemo).toHaveBeenCalledWith(expect.objectContaining({
    webmPath,
    mp4: true,
  }));
  expect(fs.existsSync(webmPath)).toBe(true);
  expect(fs.existsSync(path.join(cwd, 'store-assets', 'take-a-repo-manifest.json'))).toBe(false);
  expect(logs.some((line) => line.includes('post-processing failed'))).toBe(true);
});
