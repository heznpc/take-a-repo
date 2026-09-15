const { buildHandoffRecommendations } = require('../src/integrations');

function asset(role, id = role) {
  return {
    id,
    role,
    type: role.includes('mp4') ? 'video' : 'json',
    format: role.includes('mp4') ? 'mp4' : 'json',
    path: `store-assets/${id}`,
  };
}

describe('handoff integration recommendations', () => {
  test('recommends ready downstream tools from captured roles', () => {
    const recommendations = buildHandoffRecommendations({
      assets: [
        asset('sns-demo-mp4', 'demo-mp4'),
        asset('thumbnail', 'demo-thumb'),
        asset('storyboard-contract', 'storyboard'),
        asset('captions-contract', 'captions'),
      ],
      config: {},
    });

    expect(recommendations.slice(0, 5).map((item) => [item.id, item.readiness])).toEqual([
      ['canva', 'ready'],
      ['figma-mcp', 'ready'],
      ['higgsfield', 'ready'],
      ['remotion', 'ready'],
      ['screen-studio', 'ready'],
    ]);
    expect(recommendations.find((item) => item.id === 'figma-mcp')).toMatchObject({
      kind: 'design-mcp',
      connector: { type: 'mcp', name: 'figma' },
      confidence: 'high',
    });
  });

  test('marks avatar video as needing extra inputs, not missing take-a-repo assets', () => {
    const avatar = buildHandoffRecommendations({
      assets: [asset('storyboard-contract'), asset('captions-contract')],
    }).find((item) => item.id === 'longcat-video-avatar');

    expect(avatar).toMatchObject({
      readiness: 'needs-input',
      confidence: 'medium',
      missingRoles: [],
    });
    expect(avatar.missingInputs).toContain('avatar reference or presenter style');
  });

  test('marks tools as needing assets when required roles are missing', () => {
    const screenStudio = buildHandoffRecommendations({ assets: [] })
      .find((item) => item.id === 'screen-studio');

    expect(screenStudio).toMatchObject({
      readiness: 'needs-assets',
      confidence: 'low',
      missingRoles: ['sns-demo-mp4'],
    });
  });

  test('supports config include/exclude filters for starter-specific guidance', () => {
    const recommendations = buildHandoffRecommendations({
      assets: [asset('thumbnail'), asset('storyboard-contract')],
      config: {
        handoff: {
          targets: ['figma-mcp', 'remotion'],
          excludeTargets: ['remotion'],
        },
      },
    });

    expect(recommendations.map((item) => item.id)).toEqual(['figma-mcp']);
  });

  test('can disable adapter hints when a project wants a minimal manifest', () => {
    expect(buildHandoffRecommendations({
      assets: [asset('thumbnail'), asset('storyboard-contract')],
      config: { handoff: { recommendations: false } },
    })).toEqual([]);
  });
});
