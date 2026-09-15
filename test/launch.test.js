const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: jest.fn(),
  },
}));

const { chromium } = require('playwright');
const { launchBrowser, launchWithExtension } = require('../src/launch');

function tmpExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-launch-ext-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  return dir;
}

describe('launchWithExtension', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('removes the temp profile when Chromium fails before returning a context', async () => {
    let userDataDir;
    chromium.launchPersistentContext.mockImplementation(async (dir) => {
      userDataDir = dir;
      throw new Error('missing chromium');
    });

    await expect(launchWithExtension({ extensionDir: tmpExtension() })).rejects.toThrow(/missing chromium/);

    expect(userDataDir).toContain(`${path.sep}store-profile-`);
    expect(fs.existsSync(userDataDir)).toBe(false);
  });

  test('rewrites Playwright\'s missing-browser error into an install command that resolves the same tree', async () => {
    chromium.launchPersistentContext.mockRejectedValue(new Error(
      "browserType.launchPersistentContext: Executable doesn't exist at /cache/chromium-1234/chrome\n"
      + 'Please run the following command to download new browsers: npx playwright install',
    ));

    await expect(launchBrowser({})).rejects.toThrow(/npm i -D take-a-repo && npx playwright install chromium/);
    await expect(launchBrowser({})).rejects.toMatchObject({ exitCode: 2 });
  });

  test('leaves unrelated launch failures untouched', async () => {
    chromium.launchPersistentContext.mockRejectedValue(new Error('profile is already in use'));
    await expect(launchBrowser({})).rejects.toThrow(/profile is already in use/);
  });
});
