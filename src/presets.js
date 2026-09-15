/*
 * take-a-repo — output size presets.
 *
 * Named sizes for the two audiences take-a-repo serves: store listings (Chrome Web
 * Store) and social / SNS promo. A scene or promo tile can name a preset
 * (`preset: 'sns-video'`) or give an explicit `{ width, height }`.
 */

const PRESETS = Object.freeze({
  // ── Chrome Web Store ──
  'cws-screenshot': { width: 1280, height: 800 },
  'cws-screenshot-small': { width: 640, height: 400 },
  'cws-promo-small': { width: 440, height: 280 },
  'cws-promo-marquee': { width: 1400, height: 560 },
  // ── Social / SNS ──
  'sns-twitter': { width: 1200, height: 675 }, // X/Twitter summary_large_image (16:9 static card)
  'sns-video': { width: 1280, height: 720 }, // X/SNS demo video (even 16:9 for H.264)
  'sns-og': { width: 1200, height: 630 }, // Open Graph (link previews)
  'sns-square': { width: 1080, height: 1080 }, // Instagram / square
  'sns-portrait': { width: 1080, height: 1350 }, // Instagram portrait (4:5)
  'sns-vertical': { width: 720, height: 1280 }, // vertical short-form video (9:16)
});

/**
 * Resolve a size spec to `{ width, height }`.
 * @param {string|{width:number,height:number}|undefined} spec  a preset name or explicit size
 * @param {{width:number,height:number}} fallback
 * @returns {{width:number,height:number}}
 */
function resolveSize(spec, fallback) {
  if (!spec) return fallback;
  if (typeof spec === 'string') {
    const p = PRESETS[spec];
    if (!p) throw new Error(`take-a-repo: unknown size preset "${spec}". Known: ${Object.keys(PRESETS).join(', ')}`);
    return p;
  }
  if (spec.width && spec.height) return { width: spec.width, height: spec.height };
  return fallback;
}

module.exports = { PRESETS, resolveSize };
