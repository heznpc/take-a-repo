const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyCalibrationProfiles,
  calibrationProfileHash,
  loadCalibration,
  normalizeProfile,
  updateCalibrationProfile,
} = require('../src/calibration');

function cwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-calibration-'));
}

function profile(overrides = {}) {
  return {
    layoutPreset: 'focus-column',
    framing: { scale: 1.1, focusX: 0.4, focusY: 0.6 },
    captionOptions: { position: 'bottom-left', appearance: 'outline', bottomOffset: 420 },
    protectedRegions: [{ id: 'result', x: 40, y: 120, width: 620, height: 520 }],
    ...overrides,
  };
}

describe('calibration contract', () => {
  test('loads a missing declared file as an empty v1 document', () => {
    const root = cwd();
    expect(loadCalibration({ calibration: { from: 'take-a-repo.calibration.json' } }, root)).toEqual({
      path: path.join(root, 'take-a-repo.calibration.json'),
      layouts: [],
      document: { version: 1, profiles: {} },
    });
  });

  test('atomically writes and reloads a normalized profile', () => {
    const root = cwd();
    const config = { calibration: { from: 'config/take-a-repo.calibration.json', layouts: ['focus-column'] } };
    const updated = updateCalibrationProfile(config, root, 'demo', 'youtube-shorts', profile());

    expect(updated.profile.protectedRegions).toHaveLength(1);
    expect(fs.existsSync(path.join(root, 'config', 'take-a-repo.calibration.json'))).toBe(true);
    expect(loadCalibration(config, root).document.profiles.demo['youtube-shorts']).toEqual(updated.profile);
  });

  test('applies framing and caption overrides without replacing the run function', () => {
    const run = async () => {};
    const document = {
      version: 1,
      profiles: { demo: { 'youtube-shorts': profile() } },
    };
    const [demo] = applyCalibrationProfiles([{
      name: 'demo-youtube-shorts',
      story: 'demo',
      target: 'youtube-shorts',
      captionOptions: { mode: 'focus', bottomOffset: 380 },
      run,
    }], document);

    expect(demo.run).toBe(run);
    expect(demo.captionOptions).toMatchObject({ mode: 'focus', bottomOffset: 420, appearance: 'outline' });
    expect(demo.zoom).toEqual({ scale: 1.1, x: '(iw-iw/1.1)*0.4', y: '(ih-ih/1.1)*0.6' });
    expect(demo.calibrationProfile).toMatchObject({ layoutPreset: 'focus-column', profileHash: expect.any(String) });
  });

  test('scale 1 keeps an existing zoom unchanged', () => {
    const [demo] = applyCalibrationProfiles([{
      name: 'demo-x', story: 'demo', target: 'x', zoom: { scale: 1.05 }, run: async () => {},
    }], {
      version: 1,
      profiles: { demo: { x: profile({ framing: { scale: 1, focusX: 0.5, focusY: 0.5 } }) } },
    });
    expect(demo.zoom).toEqual({ scale: 1.05 });
  });

  test('hash excludes verification and normalizes key order', () => {
    const first = profile();
    const second = {
      ...profile(),
      verification: { profileHash: 'old', status: 'publish-ready', verifiedAt: '2026-07-10T00:00:00.000Z' },
    };
    expect(calibrationProfileHash(first)).toBe(calibrationProfileHash(second));
  });

  test('rejects unsafe paths and invalid profile bounds', () => {
    const root = cwd();
    expect(() => loadCalibration({ calibration: { from: '../outside.json' } }, root)).toThrow(/inside/);
    expect(() => normalizeProfile(profile({ framing: { scale: 1.3, focusX: 0.5, focusY: 0.5 } }))).toThrow(/scale/);
    expect(() => normalizeProfile(profile({ protectedRegions: [1, 2, 3, 4] }))).toThrow(/at most 3/);
    expect(() => normalizeProfile(profile({ captionOptions: { position: 'center' } }))).toThrow(/position/);
  });

  test('rejects undeclared layout presets and stale verification hashes', () => {
    const root = cwd();
    const config = { calibration: { from: 'take-a-repo.calibration.json', layouts: ['focus-column'] } };
    expect(() => updateCalibrationProfile(
      config,
      root,
      'demo',
      'youtube-shorts',
      profile({ layoutPreset: 'unknown' }),
    )).toThrow(/must be one of/);
    expect(() => updateCalibrationProfile(
      config,
      root,
      'demo',
      'youtube-shorts',
      profile({
        verification: {
          profileHash: 'stale',
          status: 'publish-ready',
          verifiedAt: '2026-07-10T00:00:00.000Z',
        },
      }),
    )).toThrow(/does not match/);
  });
});
