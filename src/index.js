/*
 * take-a-repo — public API.
 *
 * take-a-repo turns a BUILT browser extension (or any HTML) into automatically
 * validated channel assets. Playwright captures reusable stories; channel
 * profiles, final-file QA, and agent-owned retry actions drive them to a
 * technically verified candidate; an explicit user decision gates publication.
 *
 * Config authors typically use `capture` indirectly (via the CLI) and import
 * the helpers below inside their `take-a-repo.config.js` to set up scenes:
 *   - serveDirectory          — tiny localhost fixture server (path-traversal safe)
 *   - stageExtension          — copy an extension's files to a temp dir
 *   - patchManifestForLocalhost — widen a manifest so content scripts hit localhost
 *   - PRESETS / resolveSize    — named output sizes (CWS + SNS)
 */

const { capture, DEFAULT_VIEWPORT } = require('./capture');
const { launchBrowser, launchWithExtension, closeContext } = require('./launch');
const { buildQuickDemoConfig, makeQuickDemoRun, resolveDemoTarget } = require('./quick-demo');
const { serveDirectory, FIXTURE_CSP } = require('./serve');
const { stageExtension, patchManifestForLocalhost, LOCALHOST_MATCHES } = require('./extension');
const { compositeCaption, DEFAULT_BAND_HEIGHT } = require('./caption');
const { renderPromoTile } = require('./promo');
const {
  extractListing,
  extractPrivacyDisclosure,
  extractProductListing,
  extractProductManifest,
  renderDescriptionDoc,
  renderPrivacyDisclosureDoc,
  splitSections,
} = require('./describe');
const { PRESETS, resolveSize } = require('./presets');
const { CHANNEL_PROFILES, resolveChannelProfile } = require('./channels');
const {
  applyCalibrationProfiles,
  calibrationProfileHash,
  loadCalibration,
  updateCalibrationProfile,
} = require('./calibration');
const { startCalibrator } = require('./calibrator-server');
const { buildPublishPlan } = require('./publish');
const { findFfmpeg, buildFfmpegArgs, buildThumbnailArgs, buildVideoFilter, postProcessDemo } = require('./video');
const { DEFAULT_TARGETS, buildHandoffRecommendations } = require('./integrations');
const {
  HANDOFF_KINDS,
  HANDOFF_SCHEMA_IDS,
  HANDOFF_VERSION,
  assetRecord,
  buildHandoffDocs,
  demoStoryboard,
  writeHandoffDocs,
} = require('./handoff');
const {
  analyzeDemoStoryboard,
  createDemoController,
  demoCaptionInitScript,
  ensureDemoCaptionOverlay,
  formatStoryboardLint,
  hideDemoCaption,
  hideDemoPointer,
  installDemoCaptionOverlay,
  lintDemoStoryboard,
  moveDemoPointer,
  normalizeDelayMs,
  normalizeDemoConfigs,
  normalizeDemoCaptions,
  parseTimeToMs,
  pulseDemoPointer,
  setDemoCaption,
} = require('./demo');

module.exports = {
  fingerprintInputs: require('./evidence-inputs').fingerprintInputs,
  evidenceState: require('./evidence-state').evidenceState,
  capture,
  DEFAULT_VIEWPORT,
  // zero-config demo
  buildQuickDemoConfig,
  makeQuickDemoRun,
  resolveDemoTarget,
  // launch
  launchBrowser,
  launchWithExtension,
  closeContext,
  // fixtures
  serveDirectory,
  FIXTURE_CSP,
  // extension staging
  stageExtension,
  patchManifestForLocalhost,
  LOCALHOST_MATCHES,
  // rendering
  compositeCaption,
  DEFAULT_BAND_HEIGHT,
  renderPromoTile,
  // listing copy
  extractListing,
  extractPrivacyDisclosure,
  extractProductListing,
  extractProductManifest,
  renderDescriptionDoc,
  renderPrivacyDisclosureDoc,
  splitSections,
  // sizes
  PRESETS,
  resolveSize,
  CHANNEL_PROFILES,
  resolveChannelProfile,
  applyCalibrationProfiles,
  calibrationProfileHash,
  loadCalibration,
  updateCalibrationProfile,
  startCalibrator,
  // demo video post-processing
  findFfmpeg,
  buildFfmpegArgs,
  buildThumbnailArgs,
  buildVideoFilter,
  postProcessDemo,
  // downstream handoff recommendations
  DEFAULT_TARGETS,
  buildHandoffRecommendations,
  buildPublishPlan,
  // demo story rendering
  analyzeDemoStoryboard,
  createDemoController,
  demoCaptionInitScript,
  ensureDemoCaptionOverlay,
  formatStoryboardLint,
  hideDemoCaption,
  hideDemoPointer,
  installDemoCaptionOverlay,
  lintDemoStoryboard,
  moveDemoPointer,
  normalizeDelayMs,
  normalizeDemoConfigs,
  normalizeDemoCaptions,
  parseTimeToMs,
  pulseDemoPointer,
  setDemoCaption,
  // handoff contract
  HANDOFF_KINDS,
  HANDOFF_SCHEMA_IDS,
  HANDOFF_VERSION,
  assetRecord,
  buildHandoffDocs,
  demoStoryboard,
  writeHandoffDocs,
};
