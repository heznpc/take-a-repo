/*
 * Store-asset harness — Chromium launch.
 *
 * Loads an unpacked extension into a persistent Chromium context and hands
 * back the dynamically-assigned extension ID. The launch flags mirror the
 * ones a Playwright extension E2E suite needs — they're not optional:
 *
 *   channel: 'chromium'
 *     The default headless-shell strips the extension subsystem entirely
 *     (no service worker, MV3 onInstalled never fires) — the full Chromium
 *     channel is required. Under it, headless ALSO works (TAKE_A_REPO_HEADED=0; verified
 *     2026-06-10 on macOS + Linux CI, recordVideo included). The local
 *     default stays headed for easy debugging. Headed-under-xvfb proved
 *     unreliable on CI runners — prefer headless there.
 *
 *   --disable-features=DisableLoadExtensionCommandLineSwitch
 *     Chromium 121+ guards --load-extension behind this flag by default.
 *
 * A fresh per-launch userDataDir keeps successive runs from inheriting each
 * other's storage (and avoids "profile is already in use" locks).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

/**
 * Playwright's own "browser not downloaded" message tells the user to run
 * `npx playwright install`, which resolves a *different* playwright than the
 * one take-a-repo runs under when take-a-repo was launched through a bare `npx` — the
 * browser lands in a build directory this process never looks at. Rewrite it
 * into the instruction that works: install into the same dependency tree.
 *
 * @returns {Error|null} the replacement error, or null when this isn't that failure
 */
function missingBrowserError(err) {
  const message = err && err.message ? err.message : '';
  if (!/Executable doesn't exist|Please run the following command to download/.test(message)) return null;
  const replacement = new Error(
    "take-a-repo needs Playwright's Chromium, and this install doesn't have it yet.\n"
    + '  npm i -D take-a-repo && npx playwright install chromium\n'
    + 'Installing take-a-repo into the project first is what makes `npx playwright` resolve\n'
    + "the same Playwright take-a-repo runs under; a bare `npx playwright install` can download\n"
    + 'a build for a different version. Set TAKE_A_REPO_FFMPEG / PLAYWRIGHT_BROWSERS_PATH if you\n'
    + 'keep browsers somewhere custom.',
    { cause: err },
  );
  replacement.exitCode = 2;
  return replacement;
}

/**
 * Launch a capture context, with or without an extension.
 *
 * @param {object} opts
 * @param {string|null} [opts.extensionDir]  unpacked extension dir to --load-extension;
 *                                           null/omitted launches a plain browser (web-app capture)
 * @param {{width:number,height:number}} [opts.viewport]
 * @param {string} [opts.recordVideoDir]   when set, the context records video here
 * @param {{width:number,height:number}} [opts.recordVideoSize]
 * @returns {Promise<{context: import('playwright').BrowserContext, extensionId: string|null, userDataDir: string}>}
 */
async function launchBrowser({ extensionDir = null, viewport, recordVideoDir, recordVideoSize }) {
  if (extensionDir != null && !fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error(`launchBrowser: no manifest.json at ${extensionDir}`);
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-profile-'));

  const launchOpts = {
    channel: 'chromium',
    headless: process.env.TAKE_A_REPO_HEADED === '0',
    viewport: viewport || { width: 1280, height: 800 },
    // Force 1:1 CSS↔device pixels so a 1280×800 viewport yields a 1280×800
    // PNG (a Retina default of 2 would produce 2560×1600 — too big for CWS).
    deviceScaleFactor: 1,
    args: extensionDir
      ? [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--disable-features=DisableLoadExtensionCommandLineSwitch',
      ]
      : [],
  };
  if (recordVideoDir) {
    launchOpts.recordVideo = { dir: recordVideoDir, size: recordVideoSize || launchOpts.viewport };
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, launchOpts);
  } catch (err) {
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    throw missingBrowserError(err) || err;
  }

  if (!extensionDir) return { context, extensionId: null, userDataDir };

  // Wait for the service worker so we can read the extension ID off its URL.
  // A content-script-only extension (no MV3 worker) or a slow worker makes this
  // reject — clean up the open context and temp profile before rethrowing so a
  // failed launch never leaks a live Chromium process or a temp dir.
  let extensionId;
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    extensionId = sw.url().split('/')[2];
  } catch (err) {
    await context.close().catch(() => {});
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    throw err;
  }

  return { context, extensionId, userDataDir };
}

/**
 * Back-compat strict wrapper: extension is mandatory.
 * @param {object} opts  same as launchBrowser, but extensionDir is required
 */
async function launchWithExtension(opts) {
  const extensionDir = opts && opts.extensionDir;
  if (!extensionDir || !fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error(`launchWithExtension: no manifest.json at ${extensionDir}`);
  }
  return launchBrowser(opts);
}

/**
 * Close a context produced by launchWithExtension and remove its temp profile.
 * @param {{context: import('playwright').BrowserContext, userDataDir: string}} handle
 */
async function closeContext({ context, userDataDir }) {
  try {
    await context.close();
  } finally {
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
}

module.exports = { launchBrowser, launchWithExtension, closeContext };
