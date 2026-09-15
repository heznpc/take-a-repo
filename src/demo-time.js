const CAPTION_ROLES = new Set(['result', 'action', 'proof', 'safety', 'restore', 'cta']);

function normalizeDelayMs(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`take-a-repo: demo ${label} must be a non-negative number of milliseconds`);
  }
  return Math.round(value);
}

function parseTimeToMs(value, label = 'time') {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0) throw new Error(`take-a-repo: demo caption ${label} must be >= 0`);
    return Math.round(value * 1000);
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`take-a-repo: demo caption ${label} must be a number of seconds or a time string`);
  }

  const raw = value.trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return parseTimeToMs(Number(raw), label);

  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`take-a-repo: demo caption ${label} has invalid time string "${value}"`);
  }
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`take-a-repo: demo caption ${label} has invalid time string "${value}"`);
  }
  const [hours, minutes, seconds] = parts.length === 3 ? nums : [0, nums[0], nums[1]];
  if (minutes >= 60 || seconds >= 60) {
    throw new Error(`take-a-repo: demo caption ${label} has invalid time string "${value}"`);
  }
  return Math.round(((hours * 3600) + (minutes * 60) + seconds) * 1000);
}

function normalizeDemoCaptions(captions = []) {
  if (!captions) return [];
  if (!Array.isArray(captions)) throw new Error('take-a-repo: demo.captions must be an array');
  return captions
    .map((caption, index) => {
      if (!caption || caption.at == null) {
        throw new Error(`take-a-repo: demo.captions[${index}] needs an at time`);
      }
      if (caption.text == null) {
        throw new Error(`take-a-repo: demo.captions[${index}] needs text`);
      }
      if (caption.role != null && !CAPTION_ROLES.has(caption.role)) {
        throw new Error(`take-a-repo: demo.captions[${index}].role must be result, action, proof, safety, restore, or cta`);
      }
      return {
        atMs: parseTimeToMs(caption.at, `at for captions[${index}]`),
        text: String(caption.text),
        ...(caption.role == null ? {} : { role: caption.role }),
      };
    })
    .sort((a, b) => a.atMs - b.atMs);
}

module.exports = { normalizeDelayMs, normalizeDemoCaptions, parseTimeToMs };
