const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CAMPAIGN_FILE,
  CAMPAIGN_KIND,
  CAMPAIGN_VERSION,
  loadCampaignSelection,
  normalizeCampaignSelection,
  resolveCampaignRecipes,
  saveCampaignSelection,
} = require('../src/campaign');
const { createCampaignRunController } = require('../src/campaign-dashboard');

function targetedConfig(overrides = {}) {
  return {
    demos: [
      { name: 'proof', targets: ['x', 'youtube-shorts'], run: async () => {} },
      { name: 'onboarding', targets: ['cws-youtube'], run: async () => {} },
    ],
    ...overrides,
  };
}

describe('campaign recipes', () => {
  test('infers one recipe per targeted story with channel descriptors', () => {
    expect(resolveCampaignRecipes(targetedConfig())).toEqual([
      expect.objectContaining({
        id: 'proof',
        name: 'Proof',
        story: 'proof',
        targets: [
          expect.objectContaining({ id: 'x', platform: 'x', viewport: { width: 1280, height: 720 } }),
          expect.objectContaining({ id: 'youtube-shorts', platform: 'youtube', viewport: { width: 720, height: 1280 } }),
        ],
      }),
      expect.objectContaining({
        id: 'onboarding',
        name: 'Onboarding',
        story: 'onboarding',
        targets: [expect.objectContaining({ id: 'cws-youtube' })],
      }),
    ]);
  });

  test('applies optional recipe metadata without changing the demo contract', () => {
    const recipes = resolveCampaignRecipes(targetedConfig({
      campaign: {
        recipes: [{
          id: 'before-after-proof',
          name: 'Before / After Proof',
          description: 'Show the original task and verified result.',
          story: 'proof',
          targets: ['youtube-shorts', 'x'],
        }],
      },
    }));

    expect(recipes).toEqual([expect.objectContaining({
      id: 'before-after-proof',
      name: 'Before / After Proof',
      description: 'Show the original task and verified result.',
      story: 'proof',
      targets: [expect.objectContaining({ id: 'youtube-shorts' }), expect.objectContaining({ id: 'x' })],
    })]);
  });

  test('rejects duplicate ids and unavailable stories or targets', () => {
    expect(() => resolveCampaignRecipes(targetedConfig({
      campaign: { recipes: [{ story: 'missing' }] },
    }))).toThrow('unknown story');
    expect(() => resolveCampaignRecipes(targetedConfig({
      campaign: { recipes: [{ story: 'proof', targets: ['cws-youtube'] }] },
    }))).toThrow('unconfigured target');
    expect(() => resolveCampaignRecipes(targetedConfig({
      campaign: { recipes: [{ id: 'same', story: 'proof' }, { id: 'same', story: 'onboarding' }] },
    }))).toThrow('duplicate campaign recipe id');
  });
});

describe('campaign selection', () => {
  test('validates, persists, and reloads a recipe selection', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-campaign-'));
    const recipes = resolveCampaignRecipes(targetedConfig());
    const now = () => new Date('2026-07-11T12:00:00.000Z');

    const saved = saveCampaignSelection(outDir, recipes, {
      recipeId: 'proof',
    }, now);

    expect(saved).toEqual({
      kind: CAMPAIGN_KIND,
      version: CAMPAIGN_VERSION,
      recipeId: 'proof',
      targets: ['x', 'youtube-shorts'],
      persisted: true,
      updatedAt: '2026-07-11T12:00:00.000Z',
    });
    expect(loadCampaignSelection(outDir, recipes)).toEqual(saved);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, CAMPAIGN_FILE), 'utf8'))).toEqual({
      kind: CAMPAIGN_KIND,
      version: CAMPAIGN_VERSION,
      recipeId: 'proof',
      updatedAt: '2026-07-11T12:00:00.000Z',
    });
  });

  test('uses a non-persisted default and safely replaces stale selections', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-campaign-'));
    const recipes = resolveCampaignRecipes(targetedConfig());
    expect(loadCampaignSelection(outDir, recipes, 'onboarding')).toMatchObject({
      recipeId: 'onboarding',
      targets: ['cws-youtube'],
      persisted: false,
    });

    fs.writeFileSync(path.join(outDir, CAMPAIGN_FILE), JSON.stringify({
      version: CAMPAIGN_VERSION,
      recipeId: 'removed',
      targets: ['x'],
    }));
    expect(loadCampaignSelection(outDir, recipes)).toMatchObject({
      recipeId: 'proof',
      persisted: false,
      stale: true,
    });
  });

  test('rejects malformed and unknown recipe selections', () => {
    const recipes = resolveCampaignRecipes(targetedConfig());
    expect(() => normalizeCampaignSelection(recipes, null)).toThrow('must be an object');
    expect(() => normalizeCampaignSelection(recipes, { recipeId: 'missing' }))
      .toThrow('recipe was not found');
  });
});

describe('campaign run status', () => {
  test('preserves blocked target status after automatic attempts are exhausted', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-campaign-run-'));
    const outDir = path.join(cwd, 'store-assets');
    fs.mkdirSync(outDir);
    const config = targetedConfig();
    const recipes = resolveCampaignRecipes(config);
    const runner = jest.fn(async () => {
      fs.writeFileSync(path.join(outDir, 'take-a-repo-manifest.json'), JSON.stringify({
        handoff: {
          automation: {
            attempt: 3,
            status: 'blocked',
            targets: [{ story: 'proof', target: 'x', status: 'blocked' }],
          },
        },
      }));
      return { status: 'blocked', machineStatus: 'blocked' };
    });
    const controller = createCampaignRunController({
      cwd,
      config,
      configPath: path.join(cwd, 'take-a-repo.config.js'),
      outDir,
      recipes,
      runner,
    });

    controller.start({ recipeId: 'proof', targets: ['x'] });
    await controller.wait();

    expect(controller.snapshot()).toMatchObject({
      status: 'blocked',
      error: '1 target(s) exhausted automatic attempts',
      targets: [{ target: 'x', status: 'blocked', machineStatus: 'blocked' }],
    });
  });
});
