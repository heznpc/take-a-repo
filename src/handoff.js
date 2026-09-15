/*
 * take-a-repo — handoff contract exports.
 *
 * These files are the autonomous machine boundary: captured evidence,
 * captions, integrity, target QA, agent-owned fix/retry actions, and the final
 * user approval gate. Users review media, not manifests or repair mechanics.
 */

const crypto = require('crypto');
const path = require('path');

const { assetRecord, readProjectInfo, rel } = require('./handoff/assets');
const {
  HANDOFF_KINDS,
  HANDOFF_SCHEMA_FILES,
  HANDOFF_SCHEMA_IDS,
  HANDOFF_VERSION,
} = require('./handoff/constants');
const {
  demoCaptions,
  demoStoryboard,
  storyboardLintSummary,
} = require('./handoff/storyboard');
const { buildHandoffRecommendations } = require('./integrations');
const { buildPublishPlan } = require('./publish');
const {
  emptyApprovalDocument,
  loadApproval,
  syncManifestApproval,
} = require('./approval');
const { isValidHandoffDocs, validateHandoffDocs } = require('./handoff-validator');
const {
  copyHandoffSchemas,
  hydrateManifestAssets,
  mergeByKey,
  namesMatch,
  readJsonIfExists,
  validateFinalPack,
  writeJson,
} = require('./handoff-files');

function handoffReview(storyboardLint, run = {}, assets = []) {
  const warnings = (storyboardLint || []).flatMap((summary) => (
    (summary.warnings || []).map((warning) => ({ demo: summary.name, ...warning }))
  ));
  const incomplete = (run.skippedDemos || []).map((name) => ({
    code: 'demo-skipped',
    demo: name,
    reason: run.video ? 'not-captured' : 'video-disabled',
    fix: run.video ? `capture the ${name} demo` : 'rerun without --no-video',
  }));
  for (const asset of assets.filter((item) => item.state === 'modified')) {
    incomplete.push({
      code: 'asset-integrity-mismatch',
      asset: asset.id,
      reason: 'retained-file-changed',
      fix: `rerun the source for ${asset.id}`,
    });
  }
  return {
    status: incomplete.length ? 'incomplete' : warnings.length ? 'needs-review' : 'ready',
    warningCount: warnings.length,
    warnings,
    incomplete,
  };
}

function refreshManifestHandoff(manifest, storyboard, config, approvalDocument = emptyApprovalDocument()) {
  const automation = buildPublishPlan({
    assets: manifest.assets,
    storyboard,
    run: manifest.run,
    config,
  });
  const adapterHints = automation.status !== 'not-requested' && !automation.manualFallback ? [] : buildHandoffRecommendations({
    assets: manifest.assets,
    config,
    context: { storyboardDemoCount: storyboard.demos.length },
  });
  manifest.handoff.adapterHints = adapterHints;
  manifest.handoff.automation = automation;
  syncManifestApproval(manifest, approvalDocument);
  manifest.handoff.review = handoffReview(storyboard.storyboardLint, manifest.run, manifest.assets);
  manifest.handoff.summary = {
    assetCount: manifest.assets.length,
    demoCount: storyboard.demos.length,
    readyAdapterCount: adapterHints.filter((hint) => hint.readiness === 'ready').length,
    publishReadyTargetCount: automation.targets.filter((target) => target.status === 'publish-ready').length,
    approvedTargetCount: manifest.handoff.approval.targets.filter((target) => target.status === 'approved').length,
  };
}

function buildHandoffDocs({
  cwd,
  outDir,
  config,
  assets,
  demoConfigs,
  demoViewports,
  demoWarnings,
  demoCaptionReports = {},
  flags,
  run = {},
}) {
  const generatedAt = new Date().toISOString();
  const project = readProjectInfo(cwd);
  const runInfo = {
    id: crypto.randomUUID(),
    mode: run.mode || 'full',
    requestedScenes: run.requestedScenes || [],
    requestedTargets: run.requestedTargets || [],
    attempt: run.attempt || 1,
    video: run.video !== false,
    noBuild: !!run.noBuild,
    mp4: !!run.mp4,
    configuredDemos: run.configuredDemos || [],
    configuredTargets: run.configuredTargets || [],
    configuredTargetDemos: run.configuredTargetDemos || [],
    selectedDemos: run.selectedDemos || [],
    capturedDemos: run.capturedDemos || [],
    skippedDemos: run.skippedDemos || [],
  };
  const currentAssets = assets.map((asset) => ({
    ...asset,
    runId: runInfo.id,
    capturedAt: generatedAt,
    state: 'produced',
  }));
  const storyboard = {
    $schema: HANDOFF_SCHEMA_IDS.storyboard,
    kind: HANDOFF_KINDS.storyboard,
    version: HANDOFF_VERSION,
    generatedAt,
    project,
    purpose: 'browser-extension-demo-starter-pack',
    demos: demoConfigs.map((demoConfig) => demoStoryboard(demoConfig, demoViewports[demoConfig.name])),
    storyboardLint: storyboardLintSummary(demoWarnings),
  };
  const captions = {
    $schema: HANDOFF_SCHEMA_IDS.captions,
    kind: HANDOFF_KINDS.captions,
    version: HANDOFF_VERSION,
    generatedAt,
    project,
    demos: demoConfigs.map((demoConfig) => demoCaptions(demoConfig, demoCaptionReports[demoConfig.name])),
  };
  const manifest = {
    $schema: HANDOFF_SCHEMA_IDS.manifest,
    kind: HANDOFF_KINDS.manifest,
    version: HANDOFF_VERSION,
    generatedAt,
    tool: 'take-a-repo',
    project,
    outDir: rel(cwd, outDir),
    flags,
    run: runInfo,
    positioning: 'capture-and-handoff-kit',
    category: 'agent-ready-launch-asset-pipeline',
    handoff: {
      contractVersion: HANDOFF_VERSION,
      entrypoint: 'take-a-repo-manifest.json',
      schemas: HANDOFF_SCHEMA_IDS,
      schemaFiles: HANDOFF_SCHEMA_FILES,
      storyboards: 'storyboard.json',
      captions: 'captions.json',
      recommendedFlow: [
        'read handoff.automation and apply every agent-owned action',
        'retry listed scenes until every requested target is publish-ready',
        'present technically ready media to the user for final approval',
        'upload only the exact deliverable digest the user approved',
        'keep repo fixtures and storyboard as the repeatable source of truth',
      ],
      adapterHints: [],
      automation: null,
      approval: null,
      review: handoffReview(storyboard.storyboardLint, runInfo),
      summary: {
        assetCount: currentAssets.length,
        demoCount: storyboard.demos.length,
        readyAdapterCount: 0,
        publishReadyTargetCount: 0,
      },
    },
    assets: currentAssets,
    config: {
      disclaimer: config.disclaimer || null,
      description: config.description || null,
    },
  };
  refreshManifestHandoff(manifest, storyboard, config);
  return { storyboard, captions, manifest };
}

function compatiblePreviousPack(previous, current) {
  const { manifest, storyboard, captions } = previous;
  if (!manifest || !storyboard || !captions) return false;
  if (!isValidHandoffDocs(previous)) return false;
  if (manifest.kind !== HANDOFF_KINDS.manifest || manifest.version !== HANDOFF_VERSION) return false;
  if (storyboard.kind !== HANDOFF_KINDS.storyboard || storyboard.version !== HANDOFF_VERSION) return false;
  if (captions.kind !== HANDOFF_KINDS.captions || captions.version !== HANDOFF_VERSION) return false;
  if (!Array.isArray(manifest.assets) || !Array.isArray(storyboard.demos)
    || !Array.isArray(storyboard.storyboardLint) || !Array.isArray(captions.demos)) return false;
  if (!namesMatch(storyboard.demos, captions.demos)) return false;
  const previousProject = manifest.project && manifest.project.name;
  const currentProject = current.manifest.project && current.manifest.project.name;
  return !previousProject || !currentProject || previousProject === currentProject;
}

function writeHandoffDocs({
  cwd,
  outDir,
  config,
  assets,
  demoConfigs,
  demoViewports,
  demoWarnings,
  demoCaptionReports = {},
  flags,
  partial = false,
  run = {},
}) {
  const storyboardPath = path.join(outDir, 'storyboard.json');
  const captionsPath = path.join(outDir, 'captions.json');
  const manifestPath = path.join(outDir, 'take-a-repo-manifest.json');
  const previous = partial ? {
    manifest: readJsonIfExists(manifestPath),
    storyboard: readJsonIfExists(storyboardPath),
    captions: readJsonIfExists(captionsPath),
  } : null;
  if (previous && !previous.manifest && (previous.storyboard || previous.captions)) {
    throw new Error('take-a-repo: partial handoff requires a compatible manifest; run a full capture first');
  }
  const refreshedAssetKeys = new Set(assets.map((asset) => (
    (asset.source && asset.source.name) || asset.name
  )));
  const schemaPaths = copyHandoffSchemas(outDir, HANDOFF_SCHEMA_FILES);
  const contractAssets = [
    assetRecord({
      cwd, outDir, filePath: storyboardPath,
      name: 'storyboard', type: 'json', role: 'storyboard-contract',
      source: { kind: 'handoff' },
    }),
    assetRecord({
      cwd, outDir, filePath: captionsPath,
      name: 'captions', type: 'json', role: 'captions-contract',
      source: { kind: 'handoff' },
    }),
    assetRecord({
      cwd, outDir, filePath: manifestPath,
      name: 'take-a-repo-manifest', type: 'json', role: 'handoff-manifest',
      source: { kind: 'handoff' },
    }),
    ...schemaPaths.map((filePath) => assetRecord({
      cwd,
      outDir,
      filePath,
      name: path.basename(filePath, path.extname(filePath)),
      type: 'json',
      role: 'handoff-schema',
      source: { kind: 'handoff-schema' },
    })),
  ];
  const docs = buildHandoffDocs({
    cwd,
    outDir,
    config,
    assets: [...assets, ...contractAssets],
    demoConfigs,
    demoViewports,
    demoWarnings,
    demoCaptionReports,
    flags,
    run: { ...run, mode: partial ? 'partial' : 'full' },
  });
  // A partial run (scene filter or --no-video) only re-captures a subset, so
  // merge into the existing contract instead of overwriting a prior full run's
  // storyboard/captions/manifest with just this run's subset.
  if (partial) {
    const {
      manifest: prevManifest,
      storyboard: prevStoryboard,
      captions: prevCaptions,
    } = previous;
    if (compatiblePreviousPack(previous, docs)) {
      docs.storyboard.demos = mergeByKey(prevStoryboard.demos, docs.storyboard.demos, (demo) => demo.name);
      docs.storyboard.storyboardLint = mergeByKey(
        prevStoryboard.storyboardLint,
        docs.storyboard.storyboardLint,
        (lint) => lint.name,
      );
      docs.captions.demos = mergeByKey(prevCaptions.demos, docs.captions.demos, (demo) => demo.name);
      const previousRunId = prevManifest.run && prevManifest.run.id
        ? prevManifest.run.id
        : `legacy:${prevManifest.generatedAt}`;
      const previousAssets = (prevManifest.assets || [])
        .filter((asset) => !refreshedAssetKeys.has((asset.source && asset.source.name) || asset.name))
        .map((asset) => ({
          ...asset,
          runId: asset.runId || previousRunId,
          capturedAt: asset.capturedAt || prevManifest.generatedAt,
          state: 'retained',
        }));
      docs.manifest.assets = mergeByKey(previousAssets, docs.manifest.assets, (asset) => asset.id);
    }
  }
  writeJson(storyboardPath, docs.storyboard);
  writeJson(captionsPath, docs.captions);
  // Partial runs can inherit an older inventory. Prune entries whose files no
  // longer exist, then recompute recommendations from the actual final bundle.
  docs.manifest.assets = hydrateManifestAssets(docs.manifest.assets, outDir, manifestPath);
  refreshManifestHandoff(docs.manifest, docs.storyboard, config, loadApproval(outDir).document);
  validateHandoffDocs(docs);
  validateFinalPack(docs, outDir, manifestPath);
  writeJson(manifestPath, docs.manifest);
  return [storyboardPath, captionsPath, manifestPath, ...schemaPaths];
}

module.exports = {
  HANDOFF_KINDS,
  HANDOFF_SCHEMA_IDS,
  HANDOFF_VERSION,
  assetRecord,
  buildHandoffDocs,
  demoStoryboard,
  writeHandoffDocs,
};
