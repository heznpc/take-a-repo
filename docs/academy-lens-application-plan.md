# AcademyLens take-a-repo application plan

Do not edit AcademyLens from the take-a-repo repo. This is the intended follow-up
plan once `take-a-repo.3.0` is published or linked locally.

## Goal

Create a repeatable demo starter pack for AcademyLens:

- Chrome Web Store screenshots and listing copy.
- X/SNS source demo clips.
- `storyboard.json`, `captions.json`, and `take-a-repo-manifest.json` for handoff to
  Screen Studio, Canva, Supademo, or future MCP adapters.

## Config shape

Add `take-a-repo.config.js` in AcademyLens:

```js
const path = require('path');
const { serveDirectory, stageExtension, patchManifestForLocalhost } = require('take-a-repo');

const FIXTURES = path.join(__dirname, 'tests', 'fixtures');

module.exports = {
  build: 'npm run build:zip',
  outDir: 'store-assets',
  disclaimer: 'Unofficial · not affiliated with OpenAI',
  description: { from: 'store-assets/STORE_LISTING.md' },

  prepareExtension() {
    const dir = stageExtension(__dirname, ['manifest.json', 'src', 'assets']);
    patchManifestForLocalhost(dir);
    return dir;
  },

  async setup() {
    const server = await serveDirectory(FIXTURES, { fallback: 'openai-academy-public-course.html' });
    return { env: { baseUrl: server.baseUrl }, teardown: () => server.close() };
  },

  scenes: [
    { name: '01-course-before', preset: 'cws-screenshot', caption: 'OpenAI Academy course page before translation', async run() {} },
    { name: '02-course-translated', preset: 'cws-screenshot', caption: 'Translate lesson text with protected AI terms', async run() {} },
    { name: '03-restore-original', preset: 'cws-screenshot', caption: 'Restore the original anytime', async run() {} },
    { name: '04-popup-settings', preset: 'cws-screenshot', caption: 'Choose a target language and auto-translate setting', async run() {} },
  ],

  demos: [
    {
      name: 'demo-translate',
      audience: 'x',
      nextTool: 'screen-studio',
      preset: 'sns-video',
      mp4: { crf: 18 },
      trim: { start: 0, duration: '00:32' },
      thumbnail: { at: 1.2 },
      captions: [
        { at: 0.5, text: 'Open the Academy course page' },
        { at: 4.0, text: 'Translate visible lesson text' },
        { at: 11.0, text: 'Protected AI terms stay intact' },
        { at: 22.0, text: 'Restore the original anytime' },
      ],
      async run({ page, env, demo }) {},
    },
    {
      name: 'demo-restore',
      audience: 'x',
      nextTool: 'screen-studio',
      preset: 'sns-video',
      mp4: { crf: 18 },
      trim: { start: 0, duration: '00:24' },
      thumbnail: { at: 1.0 },
      captions: [
        { at: 0.5, text: 'Translated text stays reversible' },
        { at: 8.0, text: 'Click restore to return to the source' },
        { at: 15.0, text: 'Keep the original one click away' },
      ],
      async run({ page, env, demo }) {},
    },
  ],
};
```

## Fixture and stubbing notes

- Use `tests/fixtures/openai-academy-public-course.html` as the deterministic
  course page.
- Reuse the existing e2e translate stub idea instead of hitting Google Translate.
- Patch localhost permissions through `patchManifestForLocalhost`.
- Keep the first clip result visible within 3 seconds.

## Verification

Run from AcademyLens:

```bash
npm i -D take-a-repo
npx playwright install chromium
TAKE_A_REPO_HEADED=0 npx take-a-repo --scene demo-translate --mp4 --json
```

Expected handoff outputs:

- `store-assets/demo-translate.webm`
- `store-assets/demo-translate.mp4`
- `store-assets/demo-translate-thumbnail.png`
- `store-assets/storyboard.json`
- `store-assets/captions.json`
- `store-assets/take-a-repo-manifest.json`
