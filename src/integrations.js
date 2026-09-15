/*
 * take-a-repo — downstream handoff recommendations.
 *
 * This is intentionally advisory. take-a-repo should not hold credentials or call
 * external editors/MCP servers; it should tell agents which connectors are a
 * good next move for the assets that were just captured.
 */

const DEFAULT_TARGETS = Object.freeze([
  {
    id: 'figma-mcp',
    label: 'Figma MCP',
    kind: 'design-mcp',
    requiredRoles: ['thumbnail', 'storyboard-contract'],
    optionalRoles: ['store-screenshot', 'promo-tile', 'captions-contract', 'store-listing-copy'],
    reason: 'create social cover frames, launch graphics, or thumbnail variants from the captured proof and storyboard',
    nextStep: 'Ask an agent with Figma MCP access to create a cover frame from the thumbnail and storyboard beats.',
    connector: { type: 'mcp', name: 'figma' },
  },
  {
    id: 'screen-studio',
    label: 'Screen Studio',
    kind: 'desktop-editor',
    requiredRoles: ['sns-demo-mp4'],
    optionalRoles: ['source-demo-webm', 'captions-contract', 'thumbnail', 'storyboard-contract'],
    reason: 'polish the captured product proof with cursor smoothing, callouts, pacing, and final crop',
    nextStep: 'Import the MP4, preserve caption timing, then export the final social clip.',
  },
  {
    id: 'canva',
    label: 'Canva',
    kind: 'design-editor',
    requiredRoles: ['sns-demo-mp4', 'thumbnail'],
    optionalRoles: ['source-demo-webm', 'captions-contract', 'store-listing-copy', 'promo-tile'],
    reason: 'turn the MP4 and poster frame into lightweight social layouts or launch posts',
    nextStep: 'Use the thumbnail as the cover and the MP4 as the main media; keep captions short for mobile preview.',
  },
  {
    id: 'supademo',
    label: 'Supademo',
    kind: 'product-demo',
    requiredRoles: ['storyboard-contract'],
    optionalRoles: ['sns-demo-mp4', 'captions-contract', 'thumbnail'],
    reason: 'convert storyboard beats into a guided walkthrough or step-by-step product story',
    nextStep: 'Use storyboard beats as step names and attach the MP4 or frames as supporting proof.',
  },
  {
    id: 'remotion',
    label: 'Remotion',
    kind: 'code-video',
    requiredRoles: ['sns-demo-mp4', 'captions-contract', 'storyboard-contract'],
    optionalRoles: ['source-demo-webm', 'thumbnail'],
    reason: 'render a repeatable template-based video while keeping the captured extension proof as the source layer',
    nextStep: 'Feed the MP4, captions, and storyboard into a project-owned Remotion template.',
  },
  {
    id: 'higgsfield',
    label: 'Higgsfield or AI video studio',
    kind: 'ai-video',
    requiredRoles: ['storyboard-contract', 'thumbnail'],
    optionalRoles: ['sns-demo-mp4', 'captions-contract'],
    reason: 'generate campaign variants around the proof clip without replacing the captured product evidence',
    nextStep: 'Use the storyboard as the prompt brief and the thumbnail/MP4 as visual reference; keep take-a-repo output as the factual base.',
  },
  {
    id: 'longcat-video-avatar',
    label: 'LongCat Video Avatar or presenter video',
    kind: 'avatar-video',
    requiredRoles: ['storyboard-contract', 'captions-contract'],
    optionalRoles: ['thumbnail', 'sns-demo-mp4'],
    extraInputs: ['avatar reference or presenter style', 'voice/audio or narration text'],
    reason: 'turn captions and storyboard beats into a presenter intro or narrated wrapper around the product proof',
    nextStep: 'Derive a short script from captions, add avatar/voice inputs, then keep the take-a-repo MP4 as the product proof segment.',
  },
]);

function roleMap(assets = []) {
  const map = new Map();
  for (const asset of assets) {
    if (!asset || !asset.role || asset.state === 'modified') continue;
    if (!map.has(asset.role)) map.set(asset.role, []);
    map.get(asset.role).push(asset);
  }
  return map;
}

function assetsForRoles(byRole, roles = []) {
  return roles.flatMap((role) => byRole.get(role) || []).map((asset) => ({
    id: asset.id,
    role: asset.role,
    path: asset.path,
    type: asset.type,
    format: asset.format,
  }));
}

function normalizeTargetConfig(config = {}) {
  const handoff = config.handoff && typeof config.handoff === 'object' ? config.handoff : {};
  const include = new Set(handoff.targets || handoff.recommendTargets || []);
  const exclude = new Set(handoff.excludeTargets || []);
  const disabled = handoff.recommendations === false || handoff.adapterHints === false;
  return { include, exclude, disabled };
}

function targetAllowed(target, targetConfig) {
  if (targetConfig.disabled) return false;
  if (targetConfig.exclude.has(target.id)) return false;
  return targetConfig.include.size === 0 || targetConfig.include.has(target.id);
}

function readinessFor(target, byRole, context = {}) {
  const missingRoles = target.requiredRoles.filter((role) => !byRole.has(role));
  if (target.requiredRoles.includes('storyboard-contract') && context.storyboardDemoCount === 0) {
    missingRoles.push('storyboard-content');
  }
  if (missingRoles.length) return { readiness: 'needs-assets', confidence: 'low', missingRoles };
  if (target.extraInputs && target.extraInputs.length) {
    return { readiness: 'needs-input', confidence: 'medium', missingRoles: [] };
  }
  // take-a-repo's value is the captured clip; a "ready" recommendation with no demo
  // media at all (a scenes-only or --no-video run, where storyboard-only targets
  // still satisfy their required roles) is real but lower-confidence.
  const hasClip = byRole.has('sns-demo-mp4') || byRole.has('source-demo-webm');
  return { readiness: 'ready', confidence: hasClip ? 'high' : 'medium', missingRoles: [] };
}

function buildHandoffRecommendations({ assets = [], config = {}, context = {} } = {}) {
  const byRole = roleMap(assets);
  const targetConfig = normalizeTargetConfig(config);
  const recommendations = [];

  for (const target of DEFAULT_TARGETS) {
    if (!targetAllowed(target, targetConfig)) continue;
    const { readiness, confidence, missingRoles } = readinessFor(target, byRole, context);
    const useRoles = [...target.requiredRoles, ...(target.optionalRoles || [])];
    recommendations.push({
      id: target.id,
      label: target.label,
      kind: target.kind,
      readiness,
      confidence,
      reason: target.reason,
      nextStep: target.nextStep,
      ...(target.connector ? { connector: target.connector } : {}),
      useAssets: assetsForRoles(byRole, useRoles),
      missingRoles,
      missingInputs: target.extraInputs || [],
    });
  }

  return recommendations.sort((a, b) => {
    const readinessRank = { ready: 0, 'needs-input': 1, 'needs-assets': 2 };
    return readinessRank[a.readiness] - readinessRank[b.readiness]
      || a.id.localeCompare(b.id);
  });
}

module.exports = {
  DEFAULT_TARGETS,
  buildHandoffRecommendations,
};
