const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/launch', () => ({
  launchBrowser: jest.fn(async () => ({
    extensionId: 'test-extension',
    context: { newPage: jest.fn() },
  })),
  closeContext: jest.fn(async () => {}),
}));

const { launchBrowser: launchWithExtension } = require('../src/launch');
const { capture } = require('../src/capture');

afterEach(() => {
  jest.clearAllMocks();
});

function writeProductManifest(cwd) {
  fs.writeFileSync(path.join(cwd, 'product.manifest.json'), JSON.stringify({
    product: {
      name: 'Demo Extension',
      summary: 'A short store summary.',
      description: 'A longer listing description.',
      category: 'Productivity',
    },
    stores: {
      chromeWebStore: {
        title: 'Demo Extension',
        whatsNew: '- Added review worksheet',
      },
    },
    privacy: {
      dataCollection: 'No sale of personal data.',
      permissions: [
        {
          name: 'storage',
          purpose: 'Save preferences',
          disclosure: 'Stores settings locally.',
        },
      ],
      dataFlows: [
        {
          data: 'Selected text',
          destination: 'Example service',
          purpose: 'Return transformed text',
        },
      ],
    },
  }, null, 2));
}

test('capture writes listing and privacy worksheet from product manifest', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-capture-product-'));
  const prepareExtension = jest.fn(async () => fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-extension-')));
  writeProductManifest(cwd);

  const result = await capture({
    outDir: 'store-assets',
    description: { from: 'product.manifest.json', channel: 'chromeWebStore' },
    prepareExtension,
  }, {
    cwd,
    noBuild: true,
    noVideo: true,
    log: () => {},
  });

  const descriptionPath = path.join(cwd, 'store-assets', 'description.md');
  const privacyPath = path.join(cwd, 'store-assets', 'privacy-disclosure.md');
  const manifestPath = path.join(cwd, 'store-assets', 'take-a-repo-manifest.json');

  expect(result.produced).toContain(descriptionPath);
  expect(result.produced).toContain(privacyPath);
  expect(result.manifest).toBe(manifestPath);
  expect(fs.readFileSync(descriptionPath, 'utf8')).toContain('Demo Extension');
  expect(fs.readFileSync(privacyPath, 'utf8')).toContain('Privacy disclosure worksheet');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  expect(manifest.assets.some((asset) => asset.role === 'store-listing-copy')).toBe(true);
  expect(manifest.assets.some((asset) => asset.role === 'privacy-disclosure')).toBe(true);
  expect(prepareExtension).not.toHaveBeenCalled();
  expect(launchWithExtension).not.toHaveBeenCalled();
});

test('description-only scene does not run build, prepareExtension, or Chromium', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-capture-description-only-'));
  const prepareExtension = jest.fn(() => {
    throw new Error('prepareExtension should not run');
  });
  writeProductManifest(cwd);

  const result = await capture({
    build: `${process.execPath} -e "process.exit(7)"`,
    outDir: 'store-assets',
    description: { from: 'product.manifest.json', channel: 'chromeWebStore' },
    prepareExtension,
  }, {
    cwd,
    scenes: ['description'],
    noVideo: true,
    log: () => {},
  });

  expect(result.produced.map((filePath) => path.basename(filePath))).toEqual([
    'description.md',
    'storyboard.json',
    'captions.json',
    'take-a-repo-manifest.json',
    'take-a-repo-manifest.schema.json',
    'storyboard.schema.json',
    'captions.schema.json',
    'approval.schema.json',
  ]);
  expect(prepareExtension).not.toHaveBeenCalled();
  expect(launchWithExtension).not.toHaveBeenCalled();
});

test('capture does not delete caller-owned extension directories', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-capture-owned-extension-'));
  const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-extension-'));

  await capture({
    outDir: 'store-assets',
    handoff: false,
    prepareExtension: async () => extensionDir,
  }, {
    cwd,
    noBuild: true,
    noVideo: true,
    log: () => {},
  });

  expect(fs.existsSync(extensionDir)).toBe(true);
});

test('a filtered text recapture retains untouched handoff assets from the full run', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-capture-partial-text-'));
  writeProductManifest(cwd);
  const config = {
    outDir: 'store-assets',
    description: { from: 'product.manifest.json', channel: 'chromeWebStore' },
  };

  await capture(config, { cwd, noBuild: true, log: () => {} });
  const result = await capture(config, {
    cwd,
    scenes: ['description'],
    noBuild: true,
    log: () => {},
  });

  const manifest = JSON.parse(fs.readFileSync(result.manifest, 'utf8'));
  expect(manifest.run).toMatchObject({ mode: 'partial', requestedScenes: ['description'] });
  expect(manifest.assets.find((asset) => asset.role === 'store-listing-copy'))
    .toMatchObject({ state: 'produced' });
  expect(manifest.assets.find((asset) => asset.role === 'privacy-disclosure'))
    .toMatchObject({ state: 'retained' });
});
