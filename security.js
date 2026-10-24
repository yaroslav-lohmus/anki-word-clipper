// Shared trust boundary and input validation. No network or browser calls.
const MODELS = ['google/gemini-3.1-flash-lite', 'google/gemini-2.5-flash-lite'];
const CARD_TYPES = ['basic', 'reverse', 'reverseOnly', 'cloze'];

function sitePattern(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

function senderRole(sender, runtime) {
  if (sender?.id !== runtime.id) return null;
  if (!sender.tab && sender.url === runtime.getURL('popup.html')) return 'popup';
  if (sender.tab && sender.frameId === 0 && sitePattern(sender.url)) return 'content';
  return null;
}

function boundedText(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error('Invalid or oversized text. Select a shorter passage.');
  }
  return value.trim();
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new Error('Invalid settings.');
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'autoTranslate' && typeof value === 'boolean') result[key] = value;
    else if (key === 'defaultCardType' && CARD_TYPES.includes(value)) result[key] = value;
    else if (key === 'aiModel' && MODELS.includes(value)) result[key] = value;
    else if (
      key === 'aiKey' &&
      typeof value === 'string' &&
      value.length <= 512 &&
      !/[\r\n]/.test(value)
    )
      result[key] = value.trim();
    else throw new Error('Unsupported setting.');
  }
  return result;
}

const Security = { MODELS, CARD_TYPES, sitePattern, senderRole, boundedText, validatePatch };
if (typeof module !== 'undefined' && module.exports) module.exports = Security;
