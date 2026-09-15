const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('fontkit', () => ({ create: jest.fn() }));
jest.mock('subset-font', () => jest.fn(async () => Buffer.from('subset-font')));

const fontkit = require('fontkit');
const {
  normalizeTypographyOptions,
  prepareCaptionTypography,
  typographyStyle,
} = require('../src/caption-typography');

describe('caption typography', () => {
  afterEach(() => jest.clearAllMocks());

  test('normalizes locale-aware fitting controls without changing legacy captions', () => {
    expect(normalizeTypographyOptions({}).enabled).toBe(false);
    expect(typographyStyle({})).toBeNull();
    expect(typographyStyle({
      typography: {
        locale: 'ko-kr',
        direction: 'auto',
        family: 'Pretendard, sans-serif',
        weight: 800,
        minFontSize: 24,
        maxFontSize: 44,
        maxLines: 2,
        fit: 'shrink',
      },
    })).toMatchObject({
      locale: 'ko-KR',
      direction: 'ltr',
      family: 'Pretendard, sans-serif',
      weight: '800',
      minFontSize: 24,
      maxFontSize: 44,
      maxLines: 2,
      fit: 'shrink',
    });
    expect(() => normalizeTypographyOptions({ typography: { locale: 'ko', maxLines: 4 } }))
      .toThrow(/maxLines/);
    expect(() => normalizeTypographyOptions({ typography: { locale: 'ko', surprise: true } }))
      .toThrow(/unknown field/);
    expect(() => normalizeTypographyOptions({
      typography: {
        locale: 'ko',
        family: 'Primary Sans, sans-serif',
        fonts: [{ family: 'Korean Fallback', from: 'fonts/fallback.woff2' }],
      },
    })).toThrow(/family must reference configured font family/);
  });

  test('embeds project-local fonts and reports missing glyphs before capture', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-font-'));
    fs.mkdirSync(path.join(cwd, 'fonts'));
    fs.writeFileSync(path.join(cwd, 'fonts', 'caption.woff2'), Buffer.from('font'));
    fontkit.create.mockReturnValue({
      hasGlyphForCodePoint: (codePoint) => codePoint < 128,
    });

    try {
      const prepared = await prepareCaptionTypography({
        typography: {
          locale: 'ko-KR',
          fonts: [{ family: 'Campaign Sans', from: 'fonts/caption.woff2', weight: '100 900' }],
        },
      }, cwd, ['Translate 한글']);

      expect(prepared.runtimeOptions.typography).toMatchObject({
        enabled: true,
        locale: 'ko-KR',
        fontFaces: [{
          family: 'Campaign Sans',
          weight: '100 900',
          source: expect.stringMatching(/^data:font\/woff2;base64,/),
        }],
      });
      expect(prepared.report).toMatchObject({
        enabled: true,
        deterministic: true,
        locale: 'ko-KR',
        fontFiles: ['fonts/caption.woff2'],
        missingGlyphs: expect.arrayContaining([
          expect.objectContaining({ character: '한', codePoint: 'U+D55C' }),
        ]),
        fontOptimization: [{
          family: 'Campaign Sans',
          sourceBytes: 4,
          embeddedBytes: 11,
        }],
      });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('rejects font paths outside the project', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-font-root-'));
    const outside = path.join(os.tmpdir(), `take-a-repo-outside-${Date.now()}.woff2`);
    fs.writeFileSync(outside, 'font');
    try {
      await expect(prepareCaptionTypography({
        typography: {
          locale: 'en',
          fonts: [{ family: 'Outside', from: outside }],
        },
      }, cwd, ['Text'])).rejects.toThrow(/inside the project/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }
  });
});
