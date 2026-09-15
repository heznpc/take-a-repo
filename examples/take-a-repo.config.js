/*
 * Example take-a-repo.config.js — reference only (not executed in CI).
 *
 * A minimal config that screenshots an extension's popup and a content-script
 * state on a local fixture. Real consumers: see browser-extension-starter
 * (dummy scenes) and skillBridge (5 scenes) for working setups.
 */

const path = require('path');
const { stageExtension, patchManifestForLocalhost, serveDirectory } = require('take-a-repo');

const FIXTURES = path.join(__dirname, 'fixtures');

module.exports = {
  // Run before capture → doubles as a real-bundle smoke test (optional).
  build: 'npm run build',
  outDir: 'store-assets',
  disclaimer: 'Unofficial · sample store assets',
  description: { from: 'store-assets/STORE_LISTING.md' },

  // Stage the extension's files to a temp dir and widen the manifest so its
  // content scripts also run against the localhost fixture server.
  prepareExtension() {
    const dir = stageExtension(path.join(__dirname, '..'), ['manifest.json', 'src', 'assets']);
    patchManifestForLocalhost(dir);
    return dir;
  },

  async setup() {
    const server = await serveDirectory(FIXTURES, { fallback: 'demo.html' });
    return { env: { baseUrl: server.baseUrl }, teardown: () => server.close() };
  },

  scenes: [
    {
      name: '01-popup',
      preset: 'cws-screenshot',
      caption: 'One-click toggle from the popup',
      async run({ page, extensionId }) {
        await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`, { waitUntil: 'load' });
        await page.waitForSelector('#status');
      },
    },
    {
      // Same scene, a social size — the engine is size-agnostic.
      name: '01-popup-twitter',
      preset: 'sns-twitter',
      caption: 'Toggle it on, anywhere',
      async run({ page, extensionId }) {
        await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`, { waitUntil: 'load' });
        await page.waitForSelector('#status');
      },
    },
  ],

  promoTiles: [
    {
      name: 'promo-tile',
      template: path.join(__dirname, 'templates', 'promo.html'),
      preset: 'cws-promo-small',
      replacements: { NAME: 'My Extension', TAGLINE: 'Does one useful thing well.' },
    },
  ],

  demos: [
    {
      name: 'demo-feature',
      preset: 'sns-video',
      mp4: { crf: 18 },
      trim: { start: 0, duration: '00:35' },
      thumbnail: { at: 1.2 },
      zoom: { scale: 1.04 },
      captions: [
        { at: 0.5, text: 'Open the course page' },
        { at: 4.0, text: 'Turn the extension on' },
        { at: 11.0, text: 'The page changes in place' },
        { at: 20.0, text: 'Restore the original anytime' },
      ],
      async run({ page, extensionId, baseUrl, demo }) {
        await demo.step('Open the page', async () => {
          await page.goto(`${baseUrl}/demo.html`, { waitUntil: 'networkidle' });
        });
        await demo.step('Open the toolbar popup', async () => {
          await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`, { waitUntil: 'load' });
          await page.waitForSelector('#status');
        });
        await demo.click('.slider', { moveMs: 420, holdMs: 900 });
        await demo.caption('Restore the original anytime');
        await demo.click('.slider', { moveMs: 420, holdMs: 900 });
        await demo.wait(600);
      },
    },
    {
      name: 'demo-restore',
      preset: 'sns-video',
      mp4: { crf: 18 },
      trim: { start: 0, duration: '00:24' },
      thumbnail: { at: 1.0 },
      captions: [
        { at: 0.5, text: 'Restore the original anytime' },
        { at: 5.0, text: 'Keep a safety path visible' },
      ],
      async run({ page, extensionId, baseUrl, demo }) {
        await page.goto(`${baseUrl}/demo.html`, { waitUntil: 'networkidle' });
        await demo.step('Open the toolbar popup', async () => {
          await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`, { waitUntil: 'load' });
          await page.waitForSelector('#status');
        });
        await demo.click('.slider', { moveMs: 420, holdMs: 900 });
        await demo.click('.slider', { moveMs: 420, holdMs: 900 });
      },
    },
  ],
};
