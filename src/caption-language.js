const RTL_SCRIPTS = new Set([
  'Adlm', 'Arab', 'Hebr', 'Mand', 'Mend', 'Nkoo', 'Rohg', 'Samr', 'Syrc', 'Thaa', 'Yezi',
]);

function canonicalLocale(value) {
  if (value == null || value === '') return 'und';
  if (typeof value !== 'string') throw new Error('take-a-repo: caption typography.locale must be a string');
  try {
    return Intl.getCanonicalLocales(value.trim())[0] || 'und';
  } catch (error) {
    throw new Error(`take-a-repo: caption typography.locale "${value}" is invalid`, { cause: error });
  }
}

function localeScript(locale) {
  try {
    return new Intl.Locale(locale).maximize().script || 'Latn';
  } catch (_error) {
    return 'Latn';
  }
}

function textDirection(locale, requested = 'auto') {
  if (!['auto', 'ltr', 'rtl'].includes(requested)) {
    throw new Error('take-a-repo: caption typography.direction must be "auto", "ltr", or "rtl"');
  }
  if (requested !== 'auto') return requested;
  return RTL_SCRIPTS.has(localeScript(locale)) ? 'rtl' : 'ltr';
}

function fallbackWords(value) {
  return Array.from(value.matchAll(/\S+/gu)).map((match) => ({
    segment: match[0],
    index: match.index,
    isWordLike: true,
  }));
}

function segmentedWords(value, locale) {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return fallbackWords(value);
  const requestedLocale = locale === 'und' ? undefined : locale;
  return Array.from(new Intl.Segmenter(requestedLocale, { granularity: 'word' }).segment(value))
    .filter((part) => part.isWordLike);
}

function segmentCaptionText(text, locale = 'und') {
  const value = String(text).trim();
  if (!value) return [];
  const words = segmentedWords(value, canonicalLocale(locale));
  if (!words.length) return [{ before: '', text: value, after: '' }];

  return words.map((word, index) => {
    const next = words[index + 1];
    const end = word.index + word.segment.length;
    return {
      before: index === 0 ? value.slice(0, word.index) : '',
      text: word.segment,
      after: value.slice(end, next ? next.index : value.length),
    };
  });
}

function chunkCaptionSegments(segments, start, count) {
  const chunk = segments.slice(start, start + count).map((segment) => ({ ...segment }));
  if (!chunk.length) return chunk;
  chunk[0].before = chunk[0].before.replace(/^\s+/u, '');
  chunk[chunk.length - 1].after = chunk[chunk.length - 1].after.replace(/\s+$/u, '');
  return chunk;
}

function composeCaptionSegments(segments) {
  return segments.map((segment) => `${segment.before}${segment.text}${segment.after}`).join('');
}

function captionWords(text, locale = 'und') {
  return segmentCaptionText(text, locale).map((segment) => (
    `${segment.before}${segment.text}${segment.after.replace(/\s+/gu, '')}`
  ));
}

module.exports = {
  canonicalLocale,
  captionWords,
  chunkCaptionSegments,
  composeCaptionSegments,
  localeScript,
  segmentCaptionText,
  textDirection,
};
