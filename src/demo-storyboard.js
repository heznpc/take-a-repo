const { normalizeDemoCaptions, parseTimeToMs } = require('./demo-time');
const { analyzeFocusCaptionDensity } = require('./demo-caption-focus');

function storyboardWarning(code, message, fix, details) {
  return {
    code,
    severity: 'warning',
    message,
    fix,
    ...(details ? { details } : {}),
  };
}

function formatStoryboardLint(item) {
  return item.fix ? `${item.message}; ${item.fix}` : item.message;
}

function analyzeDemoStoryboard(demoConfig, { viewport, mp4Requested } = {}) {
  if (demoConfig.storyboardLint === false) return [];
  const warnings = [];
  // Lint must never throw — a malformed caption time should surface AS a lint
  // warning, not crash the whole capture run (this runs before any try/catch).
  let captions = [];
  let trimStartMs = 0;
  let trimDurationMs = null;
  try {
    captions = Array.isArray(demoConfig.captions) ? normalizeDemoCaptions(demoConfig.captions) : [];
  } catch (e) {
    warnings.push(storyboardWarning('invalid-captions', e.message, 'fix the caption time/text so the storyboard can be linted'));
  }
  if (demoConfig.trim && typeof demoConfig.trim === 'object') {
    if (demoConfig.trim.start != null) {
      try {
        trimStartMs = parseTimeToMs(demoConfig.trim.start, 'trim.start');
      } catch (e) {
        warnings.push(storyboardWarning('invalid-start', e.message, 'use a non-negative number of seconds or an "mm:ss" string'));
      }
    }
    if (demoConfig.trim.duration != null) {
      try {
        trimDurationMs = parseTimeToMs(demoConfig.trim.duration, 'trim.duration');
      } catch (e) {
        warnings.push(storyboardWarning('invalid-duration', e.message, 'use a number of seconds or an "mm:ss" string'));
      }
    }
  }
  const trimEndMs = trimDurationMs == null ? null : trimStartMs + trimDurationMs;
  // Story checks must describe the delivered clip, not beats that ffmpeg trims
  // away. Shift retained captions so early-result timing is also trim-relative.
  captions = captions
    .filter((caption) => caption.atMs >= trimStartMs && (trimEndMs == null || caption.atMs < trimEndMs))
    .map((caption) => ({ ...caption, atMs: caption.atMs - trimStartMs }));
  try {
    for (const density of analyzeFocusCaptionDensity(captions, demoConfig.captionOptions)) {
      const earliestNextAt = (captions[density.index].atMs + density.recommendedMs) / 1000;
      warnings.push(storyboardWarning(
        'dense-focus-caption',
        `focus caption ${density.index + 1} has ${density.availableMs}ms before the next beat`,
        `move the next caption to at least ${earliestNextAt}s or shorten this caption`,
        density,
      ));
    }
  } catch (e) {
    warnings.push(storyboardWarning(
      'invalid-caption-options',
      e.message,
      'fix demo.captionOptions before capture',
    ));
  }
  const bottomOffset = demoConfig.captionOptions && demoConfig.captionOptions.bottomOffset;
  if (viewport && Number.isFinite(bottomOffset)) {
    const estimatedCaptionHeight = demoConfig.captionOptions.mode === 'focus' ? 96 : 64;
    const maximumOffset = Math.max(0, viewport.height - estimatedCaptionHeight);
    if (bottomOffset > maximumOffset) {
      warnings.push(storyboardWarning(
        'caption-outside-viewport',
        `caption bottomOffset ${bottomOffset}px leaves no room in a ${viewport.height}px viewport`,
        `set captionOptions.bottomOffset to ${maximumOffset}px or less`,
        { bottomOffset, maximumOffset, viewportHeight: viewport.height },
      ));
    }
  }
  for (const caption of captions) {
    if (caption.text.length > 70) {
      warnings.push(storyboardWarning(
        'long-caption',
        `caption is ${caption.text.length} chars`,
        'keep captions under 70 chars when possible',
        { text: caption.text, length: caption.text.length },
      ));
    }
  }

  // Honor an explicit mp4Requested (only the caller knows about the CLI --mp4
  // flag) but also infer it from the demo config, so public callers like
  // lintDemoStoryboard() don't emit a spurious warning when demo.mp4 is set.
  const wantsMp4 = mp4Requested || !!(demoConfig.mp4 || demoConfig.crop || demoConfig.zoom);
  if (!wantsMp4) {
    warnings.push(storyboardWarning(
      'missing-mp4',
      'X/SNS demo clips should emit mp4',
      'set demo.mp4 or run take-a-repo --mp4',
    ));
  }
  if ((demoConfig.crop || demoConfig.zoom) && captions.length) {
    warnings.push(storyboardWarning(
      'edge-framing',
      'crop/zoom can cut edge captions or badges',
      'verify a frame after capture',
    ));
  }
  if (viewport && (viewport.width % 2 || viewport.height % 2)) {
    warnings.push(storyboardWarning(
      'odd-viewport',
      `viewport ${viewport.width}x${viewport.height} is not even`,
      'use even dimensions for H.264',
      { viewport },
    ));
  }

  return warnings;
}

function lintDemoStoryboard(demoConfig, options = {}) {
  return analyzeDemoStoryboard(demoConfig, options).map(formatStoryboardLint);
}

module.exports = { analyzeDemoStoryboard, formatStoryboardLint, lintDemoStoryboard };
