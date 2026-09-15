const fs = require('fs');
const path = require('path');

const { loadCampaignSelection, resolveCampaignRecipes } = require('./campaign');
const {
  captureProfileSnapshot,
  updateProfileVerification,
} = require('./calibration-verification');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function campaignTargetView(recipe, descriptor, targetsByKey) {
  const capture = targetsByKey.get(`${recipe.story}::${descriptor.id}`);
  return {
    ...descriptor,
    story: recipe.story,
    status: capture ? capture.status : 'not-requested',
    machineStatus: capture ? capture.machineStatus : 'not-requested',
    reviewable: !!(capture && capture.reviewable),
    publishable: !!(capture && capture.publishable),
    videoUrl: capture ? capture.videoUrl : null,
    thumbnailUrl: capture ? capture.thumbnailUrl : null,
    warnings: capture ? capture.warnings : [],
    review: capture ? capture.review : { status: 'not-ready', stale: false },
    assetDigest: capture ? capture.assetDigest : null,
    profileHash: capture ? capture.profileHash : null,
    candidate: capture && capture.assetDigest ? {
      assetDigest: capture.assetDigest,
      profileHash: capture.profileHash,
      videoUrl: capture.videoUrl,
      thumbnailUrl: capture.thumbnailUrl,
    } : null,
  };
}

function createCampaignStateReader({ cwd, config, outDir, state, getRun, recipes = resolveCampaignRecipes(config) }) {
  const preferredId = config.campaign && config.campaign.defaultRecipe;
  return function campaignState() {
    const captureState = state();
    const targetsByKey = new Map(captureState.targets.map((target) => [
      `${target.story}::${target.target}`,
      target,
    ]));
    const selection = loadCampaignSelection(outDir, recipes, preferredId);
    const recipeViews = recipes.map((recipe) => {
      const targets = recipe.targets.map((target) => campaignTargetView(recipe, target, targetsByKey));
      const preview = targets.find((target) => target.thumbnailUrl || target.videoUrl) || null;
      return {
        ...recipe,
        targets,
        previewUrl: preview ? preview.thumbnailUrl : null,
        selected: !!(selection && selection.recipeId === recipe.id),
      };
    });
    const activeRecipe = selection
      ? recipeViews.find((recipe) => recipe.id === selection.recipeId) || null
      : null;
    const selectedTargets = activeRecipe
      ? activeRecipe.targets.filter((target) => selection.targets.includes(target.id))
      : [];
    const allReviewable = selectedTargets.length > 0 && selectedTargets.every((target) => target.reviewable);
    const allApproved = selectedTargets.length > 0 && selectedTargets.every((target) => target.publishable);
    const hasChangesRequested = selectedTargets.some((target) => target.review.status === 'changes-requested');
    const run = getRun();
    let phase = 'plan';
    if (selection && selection.persisted) {
      if (run.status === 'running') phase = 'production';
      else if (allApproved) phase = 'complete';
      else if (hasChangesRequested) phase = 'production';
      else if (allReviewable) phase = 'review';
      else phase = 'production';
    }
    return {
      version: 1,
      project: path.basename(cwd),
      calibratorAvailable: captureState.calibratorAvailable,
      calibratorUrl: captureState.calibratorAvailable ? '/' : null,
      phase,
      recipes: recipeViews,
      selection,
      run,
      summary: {
        selected: selectedTargets.length,
        publishReady: selectedTargets.filter((target) => target.machineStatus === 'publish-ready').length,
        reviewable: selectedTargets.filter((target) => target.reviewable).length,
        approved: selectedTargets.filter((target) => target.publishable).length,
      },
    };
  };
}

function nextAttempt(outDir) {
  const manifest = readJson(path.join(outDir, 'take-a-repo-manifest.json'), {});
  const currentAttempt = manifest.handoff && manifest.handoff.automation
    ? Number(manifest.handoff.automation.attempt) || 0
    : 0;
  return Math.max(1, currentAttempt + 1);
}

async function recaptureCampaign({ cwd, config, configPath, outDir, story, targets, runner }) {
  const attempt = nextAttempt(outDir);
  const snapshots = new Map(targets.map((target) => [
    target,
    captureProfileSnapshot(config, cwd, story, target),
  ]));
  const result = await runner({ cwd, configPath, story, targets, attempt, noBuild: false });
  const manifest = readJson(path.join(outDir, 'take-a-repo-manifest.json'), {});
  const automationTargets = manifest.handoff && manifest.handoff.automation
    ? manifest.handoff.automation.targets || []
    : [];
  const results = targets.map((target) => {
    const technical = automationTargets.find((item) => item.story === story && item.target === target);
    const machineStatus = technical ? technical.status : result.machineStatus || 'not-requested';
    const verification = updateProfileVerification(
      config,
      cwd,
      story,
      target,
      machineStatus,
      snapshots.get(target),
    );
    return { target, machineStatus, ...verification };
  });
  return { attempt, result, targets: results };
}

function createCampaignRunController({
  cwd,
  config,
  configPath,
  outDir,
  recipes,
  runner,
  onRunningChange = () => {},
}) {
  let activeRun = null;
  let sequence = 0;
  let run = { id: null, status: 'idle', targets: [] };

  function snapshot() {
    return { ...run, targets: run.targets.map((target) => ({ ...target })) };
  }

  function reset() {
    if (run.status === 'running') throw new Error('take-a-repo: campaign capture is running');
    run = { id: null, status: 'idle', targets: [] };
  }

  function start(selection) {
    const recipe = recipes.find((item) => item.id === selection.recipeId);
    run = {
      id: `${Date.now().toString(36)}-${++sequence}`,
      status: 'running',
      recipeId: recipe.id,
      story: recipe.story,
      startedAt: new Date().toISOString(),
      targets: selection.targets.map((target) => ({ target, status: 'queued' })),
    };
    onRunningChange(true);
    activeRun = (async () => {
      for (const item of run.targets) item.status = 'running';
      try {
        const batch = await recaptureCampaign({
          cwd,
          config,
          configPath,
          outDir,
          story: recipe.story,
          targets: selection.targets,
          runner,
        });
        run.attempt = batch.attempt;
        for (const result of batch.targets) {
          const item = run.targets.find((target) => target.target === result.target);
          item.machineStatus = result.machineStatus;
          item.deliveryStatus = batch.result.status || 'not-requested';
          if (result.machineStatus === 'publish-ready' && result.verified) item.status = 'publish-ready';
          else if (result.machineStatus === 'blocked') item.status = 'blocked';
          else item.status = 'needs-fix';
        }
      } catch (error) {
        for (const item of run.targets) {
          item.status = 'failed';
          item.error = error.message;
        }
      }
      const failed = run.targets.filter((target) => target.status === 'failed');
      const blocked = run.targets.filter((target) => target.status === 'blocked');
      const needsFix = run.targets.filter((target) => target.status === 'needs-fix');
      run.status = failed.length ? 'failed' : blocked.length ? 'blocked' : needsFix.length ? 'needs-fix' : 'completed';
      run.completedAt = new Date().toISOString();
      if (failed.length) run.error = `${failed.length} target(s) failed`;
      else if (blocked.length) run.error = `${blocked.length} target(s) exhausted automatic attempts`;
    })().finally(() => {
      onRunningChange(false);
      activeRun = null;
    });
    return snapshot();
  }

  async function wait() {
    if (activeRun) await activeRun;
  }

  return { reset, snapshot, start, wait };
}

module.exports = {
  createCampaignRunController,
  createCampaignStateReader,
  nextAttempt,
};
