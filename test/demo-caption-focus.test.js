const {
  analyzeFocusCaptionDensity,
  buildCaptionFrames,
  buildCaptionTimeline,
  captionStyle,
  normalizeFocusOptions,
  splitCaptionWords,
} = require('../src/demo-caption-focus');

describe('focused demo captions', () => {
  test('keeps static caption schedules backward compatible', () => {
    expect(buildCaptionFrames([{ atMs: 500, text: 'Show the result' }])).toEqual([
      {
        atMs: 500,
        text: 'Show the result',
        sourceAtMs: 500,
        sourceText: 'Show the result',
        options: {},
      },
    ]);
  });

  test('builds timed word highlights in compact chunks', () => {
    const frames = buildCaptionFrames([
      { atMs: 500, text: 'Translate the whole lesson now' },
    ], {
      mode: 'focus',
      wordsPerChunk: 2,
      wordMs: 200,
    });
    expect(frames.map(({ atMs, text, options }) => ({
      atMs,
      text,
      focusWords: options.focusWords,
      activeWordIndex: options.activeWordIndex,
    }))).toEqual([
      {
        atMs: 500,
        text: 'Translate the',
        focusWords: ['Translate', 'the'],
        activeWordIndex: 0,
      },
      {
        atMs: 700,
        text: 'Translate the',
        focusWords: ['Translate', 'the'],
        activeWordIndex: 1,
      },
      {
        atMs: 900,
        text: 'whole lesson now',
        focusWords: ['whole', 'lesson', 'now'],
        activeWordIndex: 0,
      },
      {
        atMs: 1100,
        text: 'whole lesson now',
        focusWords: ['whole', 'lesson', 'now'],
        activeWordIndex: 1,
      },
      {
        atMs: 1300,
        text: 'whole lesson now',
        focusWords: ['whole', 'lesson', 'now'],
        activeWordIndex: 2,
      },
    ]);
    expect(frames.every((frame) => frame.sourceText === 'Translate the whole lesson now')).toBe(true);
  });

  test('compresses pacing so every word appears before the next beat', () => {
    const frames = buildCaptionFrames([
      { atMs: 0, text: 'One two three four' },
      { atMs: 500, text: 'Next beat' },
    ], { mode: 'focus', wordMs: 300 });

    const firstCaption = frames.filter((frame) => frame.sourceText === 'One two three four');
    expect(firstCaption.map((frame) => frame.atMs)).toEqual([0, 125, 250, 375]);
    expect(firstCaption.at(-1).text).toBe('three four');
    expect(frames.find((frame) => frame.atMs === 500).text).toBe('Next beat');
    expect(analyzeFocusCaptionDensity([
      { atMs: 0, text: 'One two three four' },
      { atMs: 500, text: 'Next beat' },
    ], { mode: 'focus', wordMs: 300 })).toEqual([
      { index: 0, wordCount: 4, availableMs: 500, recommendedMs: 1200 },
    ]);
  });

  test('keeps authored Korean phrases together while animating each word', () => {
    const { normalizeDemoCaptions } = require('../src/demo-time');
    const { captionSchedule } = require('../src/production-captions');
    const text = 'Claude 같은 전문 용어는 그대로';
    const focusChunks = ['Claude 같은', '전문 용어는 그대로'];
    const options = { mode: 'focus', wordsPerChunk: 2, wordMs: 420, typography: { locale: 'ko-KR' } };
    const browser = buildCaptionFrames(normalizeDemoCaptions([{ at: 0, text, focusChunks }]), options);
    const production = buildCaptionFrames(captionSchedule([{ start: 0, end: 4, text, focusChunks }]), options).filter((frame) => frame.text);
    expect(production).toEqual(browser);
    expect(browser.map((frame) => frame.text)).toEqual([
      'Claude 같은', 'Claude 같은', '전문 용어는 그대로', '전문 용어는 그대로', '전문 용어는 그대로',
    ]);
    expect(browser.map((frame) => frame.options.activeWordIndex)).toEqual([0, 1, 0, 1, 2]);
    expect(browser.map((frame) => frame.atMs)).toEqual([0, 420, 840, 1260, 1680]);
  });

  test.each([
    [], ['One two'], ['two', 'One three'], ['On', 'e two three'], ['One two three!'], [42],
  ].map((focusChunks) => ({ focusChunks })))('rejects phrase boundaries that alter the authored text (%p)', ({ focusChunks }) => {
    expect(() => buildCaptionFrames([{ atMs: 0, text: 'One two three', focusChunks }], { mode: 'focus' })).toThrow(/focusChunks/);
  });

  test('authored Japanese phrases retain their punctuation and unspaced boundaries', () => {
    const frames = buildCaptionFrames([{ atMs: 0, text: '翻訳結果を確認します。', focusChunks: ['翻訳結果を', '確認します。'] }], {
      mode: 'focus', typography: { locale: 'ja-JP' },
    });
    expect([...new Set(frames.map((frame) => frame.text))]).toEqual(['翻訳結果を', '確認します。']);
  });

  test('preserves the full phrase when even chunk pacing is too dense', () => {
    const [frame] = buildCaptionFrames([
      { atMs: 0, text: 'One two three four five six seven' },
      { atMs: 100, text: 'Next beat' },
    ], { mode: 'focus' });

    expect(frame).toMatchObject({
      atMs: 0,
      text: 'One two three four five six seven',
      options: {
        focusWords: ['One', 'two', 'three', 'four', 'five', 'six', 'seven'],
        condensed: true,
      },
    });
  });

  test('emits a portable frame timeline with trim-relative boundaries', () => {
    const frames = buildCaptionFrames([
      { atMs: 0, text: 'One two' },
    ], { mode: 'focus', wordMs: 200 });

    expect(buildCaptionTimeline(frames, { startMs: 100, endMs: 700 })).toEqual([
      {
        at: 0,
        atMs: 0,
        endAt: 0.1,
        endMs: 100,
        text: 'One two',
        sourceText: 'One two',
        words: ['One', 'two'],
        activeWordIndex: 0,
        condensed: false,
      },
      {
        at: 0.1,
        atMs: 100,
        endAt: 0.6,
        endMs: 600,
        text: 'One two',
        sourceText: 'One two',
        words: ['One', 'two'],
        activeWordIndex: 1,
        condensed: false,
      },
    ]);
  });

  test('clamps every timeline frame to the delivered clip end', () => {
    const frames = buildCaptionFrames([
      { atMs: 0, text: 'One two three' },
    ], { mode: 'focus', wordMs: 200 });

    expect(buildCaptionTimeline(frames, { endMs: 350 }).map((frame) => ({
      atMs: frame.atMs,
      endMs: frame.endMs,
      activeWordIndex: frame.activeWordIndex,
    }))).toEqual([
      { atMs: 0, endMs: 200, activeWordIndex: 0 },
      { atMs: 200, endMs: 350, activeWordIndex: 1 },
    ]);
  });

  test('normalizes style metadata and validates controls', () => {
    expect(captionStyle({
      position: 'bottom',
      mode: 'focus',
      appearance: 'outline',
      bottomOffset: 119.7,
    })).toEqual({
      mode: 'focus',
      appearance: 'outline',
      position: 'bottom',
      bottomOffset: 120,
      wordsPerChunk: 3,
      wordMs: 360,
      activeColor: '#facc15',
    });
    expect(splitCaptionWords('  번역 결과를   바로 확인하세요 ')).toEqual(['번역', '결과를', '바로', '확인하세요']);
    const japanese = splitCaptionWords('翻訳結果を確認します。');
    expect(japanese.length).toBeGreaterThan(1);
    expect(japanese.join('')).toBe('翻訳結果を確認します。');
    expect(normalizeFocusOptions(null)).toEqual({ mode: 'static' });
    expect(() => normalizeFocusOptions({ mode: 'karaoke' })).toThrow(/must be "static" or "focus"/);
    expect(() => normalizeFocusOptions({ mode: 'focus', wordsPerChunk: 0 })).toThrow(/wordsPerChunk/);
    expect(() => normalizeFocusOptions({ mode: 'focus', wordMs: 20 })).toThrow(/wordMs/);
    expect(() => normalizeFocusOptions({ mode: 'focus', bottomOffset: -1 })).toThrow(/bottomOffset/);
    expect(() => normalizeFocusOptions({ mode: 'focus', position: 'middle' })).toThrow(/position/);
    expect(() => normalizeFocusOptions({ mode: 'focus', appearance: 'bubble' })).toThrow(/appearance/);
    expect(() => normalizeFocusOptions('focus')).toThrow(/must be an object/);
  });

  test('records locale typography and preserves Japanese separators in focus frames', () => {
    const frames = buildCaptionFrames([
      { atMs: 0, text: 'AIレッスンを翻訳します。' },
    ], {
      mode: 'focus',
      wordsPerChunk: 3,
      typography: {
        locale: 'ja-JP',
        family: 'Noto Sans JP, sans-serif',
        minFontSize: 26,
        maxFontSize: 42,
      },
    });

    expect(frames.map((frame) => frame.text).join('')).not.toContain('AI レッスン');
    expect(frames[0].options).toMatchObject({ locale: 'ja-JP', direction: 'ltr' });
    expect(captionStyle({
      mode: 'focus',
      typography: { locale: 'ja-JP', family: 'Noto Sans JP, sans-serif' },
    })).toMatchObject({
      locale: 'ja-JP',
      direction: 'ltr',
      typography: {
        locale: 'ja-JP',
        family: 'Noto Sans JP, sans-serif',
        fit: 'shrink',
        maxLines: 2,
      },
    });
  });

  test('balances chunks instead of leaving a one-word final orphan', () => {
    const frames = buildCaptionFrames([
      { atMs: 0, text: 'AI 강의를 바로 번역' },
    ], {
      mode: 'focus',
      wordsPerChunk: 3,
      typography: { locale: 'ko-KR' },
    });

    expect([...new Set(frames.map((frame) => frame.text))]).toEqual([
      'AI 강의를',
      '바로 번역',
    ]);
  });
});
