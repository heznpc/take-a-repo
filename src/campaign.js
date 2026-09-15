const fs = require('fs');
const path = require('path');

const { CHANNEL_PROFILES } = require('./channels');
const { normalizeDemoConfigs } = require('./demo');
const { readJsonIfExists, writeJson } = require('./handoff-files');

const CAMPAIGN_FILE = 'take-a-repo-campaign.json';
const CAMPAIGN_KIND = 'take-a-repo.campaign-selection';
const CAMPAIGN_VERSION = 1;

function humanize(value) {
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function recipeId(value, fallback) {
  const id = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!id) throw new Error('take-a-repo: campaign recipe needs an id');
  return id;
}

function targetDescriptor(demo) {
  const id = demo.target;
  const profile = demo.targetProfile || CHANNEL_PROFILES[id];
  return {
    id,
    variantName: demo.name,
    label: profile ? profile.label : humanize(id),
    platform: demo.channel || (profile ? profile.platform : id),
    delivery: profile ? profile.delivery : null,
    viewport: profile ? profile.viewport : null,
    outputRoles: ['sns-demo-mp4', 'thumbnail'],
  };
}

function configuredStories(config) {
  const stories = new Map();
  for (const demo of normalizeDemoConfigs(config)) {
    if (!demo.target) continue;
    const story = demo.story || demo.name;
    if (!stories.has(story)) stories.set(story, new Map());
    const targets = stories.get(story);
    if (!targets.has(demo.target)) targets.set(demo.target, demo);
  }
  return stories;
}

function validateCampaignConfig(config) {
  if (config.campaign == null) return null;
  if (!config.campaign || typeof config.campaign !== 'object' || Array.isArray(config.campaign)) {
    throw new Error('take-a-repo: config.campaign must be an object');
  }
  if (config.campaign.recipes == null) return null;
  if (!Array.isArray(config.campaign.recipes) || !config.campaign.recipes.length) {
    throw new Error('take-a-repo: config.campaign.recipes must be a non-empty array');
  }
  return config.campaign.recipes;
}

function resolveCampaignRecipes(config = {}) {
  const stories = configuredStories(config);
  const configured = validateCampaignConfig(config);
  const source = configured || [...stories].map(([story, targets]) => ({ story, targets: [...targets.keys()] }));
  const seen = new Set();

  return source.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`take-a-repo: campaign recipe ${index} must be an object`);
    }
    const story = entry.story;
    if (typeof story !== 'string' || !stories.has(story)) {
      throw new Error(`take-a-repo: campaign recipe ${index} references an unknown story`);
    }
    const availableTargets = stories.get(story);
    const targets = entry.targets == null ? [...availableTargets.keys()] : entry.targets;
    if (!Array.isArray(targets) || !targets.length) {
      throw new Error(`take-a-repo: campaign recipe "${story}" needs at least one target`);
    }
    if (targets.some((target) => typeof target !== 'string' || !availableTargets.has(target))) {
      throw new Error(`take-a-repo: campaign recipe "${story}" contains an unconfigured target`);
    }
    const id = recipeId(entry.id, story);
    if (seen.has(id)) throw new Error(`take-a-repo: duplicate campaign recipe id "${id}"`);
    seen.add(id);
    const uniqueTargets = [...new Set(targets)];
    return {
      id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : humanize(story),
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      story,
      targets: uniqueTargets.map((target) => targetDescriptor(availableTargets.get(target))),
    };
  });
}

function defaultSelection(recipes, preferredId) {
  const preferred = recipes.find((recipe) => recipe.id === preferredId) || recipes[0] || null;
  return preferred ? {
    kind: CAMPAIGN_KIND,
    version: CAMPAIGN_VERSION,
    recipeId: preferred.id,
    targets: preferred.targets.map((target) => target.id),
    persisted: false,
  } : null;
}

function normalizeCampaignSelection(recipes, input, options = {}) {
  if (!recipes.length) throw new Error('take-a-repo: no campaign recipes are configured');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('take-a-repo: campaign selection must be an object');
  }
  const recipe = recipes.find((item) => item.id === input.recipeId);
  if (!recipe) throw new Error('take-a-repo: campaign recipe was not found');
  return {
    kind: CAMPAIGN_KIND,
    version: CAMPAIGN_VERSION,
    recipeId: recipe.id,
    targets: recipe.targets.map((target) => target.id),
    persisted: options.persisted !== false,
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
  };
}

function selectionPath(outDir) {
  return path.join(outDir, CAMPAIGN_FILE);
}

function loadCampaignSelection(outDir, recipes, preferredId) {
  const fallback = defaultSelection(recipes, preferredId);
  const document = readJsonIfExists(selectionPath(outDir));
  if (!document) return fallback;
  try {
    if (document.kind !== CAMPAIGN_KIND || document.version !== CAMPAIGN_VERSION) {
      throw new Error('stale campaign selection');
    }
    return normalizeCampaignSelection(recipes, document, {
      persisted: true,
      updatedAt: document.updatedAt,
    });
  } catch (_error) {
    return fallback ? { ...fallback, stale: true } : null;
  }
}

function saveCampaignSelection(outDir, recipes, input, now = () => new Date()) {
  const selected = normalizeCampaignSelection(recipes, input, {
    persisted: true,
    updatedAt: now().toISOString(),
  });
  fs.mkdirSync(outDir, { recursive: true });
  const document = {
    kind: CAMPAIGN_KIND,
    version: CAMPAIGN_VERSION,
    recipeId: selected.recipeId,
    updatedAt: selected.updatedAt,
  };
  writeJson(selectionPath(outDir), document);
  return selected;
}

module.exports = {
  CAMPAIGN_FILE,
  CAMPAIGN_KIND,
  CAMPAIGN_VERSION,
  defaultSelection,
  loadCampaignSelection,
  normalizeCampaignSelection,
  resolveCampaignRecipes,
  saveCampaignSelection,
};
