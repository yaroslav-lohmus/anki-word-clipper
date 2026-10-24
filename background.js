importScripts('anki-client.js', 'translator.js', 'security.js');
const api = chrome;
const ANKI_URL = 'http://127.0.0.1:8765';
const DEFAULT_SETTINGS = {
  lastDeck: 'Estonian',
  deckPreferenceVersion: 1,
  defaultCardType: 'basic',
  autoTranslate: false,
  aiModel: Security.MODELS[0],
  aiKey: '',
  modelTtsLang: null,
};
let modelReady = false;
// Deny direct storage access from content scripts before reading any secrets.
const storageReady = api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
storageReady.catch(() => {}); // Requests fail closed if storage protection fails.
let settingsQueue = Promise.resolve();

async function ankiFetch(action, params = {}) {
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    res = await fetch(ANKI_URL, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({ action, version: 6, params }),
      signal: ctrl.signal,
    });
  } catch {
    throw {
      code: 'ANKI_UNREACHABLE',
      message: 'Anki is unavailable. Open Anki Desktop with AnkiConnect and retry.',
    };
  } finally {
    clearTimeout(timer);
  }
  const out = AnkiClient.interpretResponse(await res.json().catch(() => null));
  if (!out.ok) throw out;
  return out.result;
}

// updateModelTemplates wants { "Template Name": {Front, Back}, … }
function templatesObj(def) {
  const o = {};
  for (const t of def.cardTemplates) o[t.Name] = { Front: t.Front, Back: t.Back };
  return o;
}

// Preserve existing fields while migrating old note types to speech-free templates.
async function ensureModel() {
  const s = await getSettings();
  const names = await ankiFetch('modelNames');
  const def = AnkiClient.buildModelDef('off');
  if (!names.includes(AnkiClient.MODEL_NAME)) {
    await ankiFetch('createModel', def);
    await patchSettings({ modelTtsLang: 'off' });
  } else {
    // migration: older installs lack the Forms/Example fields
    const fields = await ankiFetch('modelFieldNames', { modelName: AnkiClient.MODEL_NAME });
    let added = false;
    for (const f of ['Forms', 'Example', 'OnlyReverse']) {
      if (!fields.includes(f)) {
        await ankiFetch('modelFieldAdd', { modelName: AnkiClient.MODEL_NAME, fieldName: f });
        added = true;
      }
    }
    if (added || s.modelTtsLang !== 'off') {
      await ankiFetch('updateModelTemplates', {
        model: { name: def.modelName, templates: templatesObj(def) },
      });
      await patchSettings({ modelTtsLang: 'off' });
    }
  }
  if (!names.includes(AnkiClient.CLOZE_MODEL_NAME)) {
    await ankiFetch('createModel', AnkiClient.buildClozeModelDef());
  }
}

// requestPermission is the only action AnkiConnect answers for unknown
// origins; on first call Anki shows a dialog the user must accept.
async function check() {
  try {
    const perm = await ankiFetch('requestPermission');
    if (perm.permission !== 'granted') {
      modelReady = false;
      return {
        ok: false,
        code: 'PERMISSION_DENIED',
        message: 'Anki access denied. Click Yes in Anki and retry.',
      };
    }
    if (!modelReady) {
      await ensureModel();
      modelReady = true;
    }
    return { ok: true };
  } catch (e) {
    modelReady = false;
    return { ok: false, code: e.code ?? 'UNKNOWN', message: e.message ?? String(e) };
  }
}

async function getSettings() {
  await storageReady;
  const { settings: stored = {} } = await api.storage.local.get('settings');
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settings)) {
    if (Object.hasOwn(stored, key)) settings[key] = stored[key];
  }
  // Drop legacy provider keys, endpoint URLs, prompts, and unused preferences.
  if (!Security.MODELS.includes(settings.aiModel)) settings.aiModel = DEFAULT_SETTINGS.aiModel;
  if (!Security.CARD_TYPES.includes(settings.defaultCardType)) settings.defaultCardType = 'basic';
  if (typeof settings.aiKey !== 'string') settings.aiKey = '';
  if (typeof settings.autoTranslate !== 'boolean') settings.autoTranslate = false;
  const deckMigration = stored.deckPreferenceVersion !== 1;
  if (deckMigration && (!settings.lastDeck || settings.lastDeck === 'Default'))
    settings.lastDeck = 'Estonian';
  settings.deckPreferenceVersion = 1;
  const legacy = Object.keys(stored).some((key) => !Object.hasOwn(DEFAULT_SETTINGS, key));
  if (legacy) {
    settings.autoTranslate = false;
    if (stored.aiBaseUrl !== 'https://openrouter.ai/api/v1') settings.aiKey = '';
  }
  if (legacy || deckMigration) {
    await api.storage.local.set({ settings });
  }
  return settings;
}

function patchSettings(patch) {
  const operation = settingsQueue
    .catch(() => {})
    .then(async () => {
      const settings = await getSettings();
      await api.storage.local.set({ settings: { ...settings, ...patch } });
    });
  settingsQueue = operation;
  return operation;
}

function publicSettings(settings) {
  return {
    lastDeck: settings.lastDeck,
    defaultCardType: settings.defaultCardType,
    autoTranslate: settings.autoTranslate,
    aiModel: settings.aiModel,
    hasApiKey: Boolean(settings.aiKey),
  };
}

async function getDecks() {
  const c = await check();
  if (!c.ok) return c;
  const decks = await ankiFetch('deckNames');
  if (!decks.includes('Estonian')) {
    await ankiFetch('createDeck', { deck: 'Estonian' });
    decks.push('Estonian');
  }
  const preferred = (await getSettings()).lastDeck;
  return { ok: true, decks, lastDeck: decks.includes(preferred) ? preferred : 'Estonian' };
}

async function addNote(input, sender) {
  if (!input || typeof input !== 'object') throw new Error('Invalid card.');
  const note = {};
  for (const key of ['word', 'matchWord', 'translation', 'context', 'forms', 'example']) {
    note[key] = Security.boundedText(input[key] ?? '', 4000, key === 'word');
  }
  note.deck = Security.boundedText(input.deck, 300, true);
  if (!Security.CARD_TYPES.includes(input.cardType)) throw new Error('Invalid card type.');
  note.cardType = input.cardType;
  note.allowDuplicate = input.allowDuplicate === true;
  note.source = `${String(sender.tab.title ?? '').slice(0, 500)} — ${sender.url}`;
  const c = await check();
  if (!c.ok) return c;
  const req =
    note.cardType === 'cloze'
      ? AnkiClient.buildClozeNoteRequest(note)
      : AnkiClient.buildAddNoteRequest({
          ...note,
          reverse: note.cardType === 'reverse' || note.cardType === 'reverseOnly',
          onlyReverse: note.cardType === 'reverseOnly',
        });
  await ankiFetch(req.action, req.params);
  await patchSettings({ lastDeck: note.deck });
  return { ok: true };
}

let translationInFlight = false;
async function translate(text, context = '', wide = '', avoid = '', test = false) {
  text = Security.boundedText(text, 2000, true);
  context = Security.boundedText(context, 3000);
  wide = Security.boundedText(wide, 3000);
  avoid = Security.boundedText(avoid, 2000);
  const settings = await getSettings();
  if (!test && !settings.autoTranslate)
    return {
      ok: false,
      code: 'DISABLED',
      message: 'Translation is off. Enter a meaning yourself or enable it in settings.',
    };
  if (!settings.aiKey)
    return { ok: false, message: 'Save an OpenRouter API key in extension settings.' };
  if (translationInFlight)
    return { ok: false, message: 'A translation is already running. Try again shortly.' };
  translationInFlight = true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const req = Translator.buildAiRequest({
      apiKey: settings.aiKey,
      model: settings.aiModel,
      word: text,
      context,
      wide,
      avoid,
    });
    const res = await fetch(req.url, { ...req.options, signal: ctrl.signal });
    if (!res.ok)
      return {
        ok: false,
        message: `OpenRouter returned HTTP ${res.status}. Check your key, credits, and model.`,
      };
    const out = Translator.parseAiResponse(await res.json());
    if (!out)
      return {
        ok: false,
        message:
          'OpenRouter returned an invalid translation. Try again or enter a meaning yourself.',
      };
    return { ok: true, provider: 'ai', ...out };
  } catch {
    return {
      ok: false,
      message: 'Translation failed or timed out. No other provider was contacted.',
    };
  } finally {
    clearTimeout(timer);
    translationInFlight = false;
  }
}

async function handleMessage(msg, sender) {
  const role = Security.senderRole(sender, api.runtime);
  if (
    !role ||
    (role === 'content' &&
      !(await api.permissions.contains({ origins: [Security.sitePattern(sender.url)] })))
  ) {
    return { ok: false, code: 'FORBIDDEN', message: 'Enable Word Clipper on this site first.' };
  }
  if (role === 'popup') {
    switch (msg?.type) {
      case 'CHECK_CONNECTION':
        return check();
      case 'GET_SETTINGS':
        return { ok: true, settings: publicSettings(await getSettings()) };
      case 'SET_SETTINGS':
        await patchSettings(Security.validatePatch(msg.patch));
        return { ok: true };
      case 'ENABLE_SITE':
        return enableSite(msg.tabId);
      case 'TEST_AI': {
        const sample = await translate('raamatut', 'Ma loen raamatut.', '', '', true);
        return sample.ok ? { ok: true, sample } : sample;
      }
      default:
        return { ok: false, code: 'FORBIDDEN', message: 'Request not allowed.' };
    }
  }
  switch (msg?.type) {
    case 'GET_SETTINGS':
      return { ok: true, settings: { defaultCardType: (await getSettings()).defaultCardType } };
    case 'SET_CARD_TYPE':
      await patchSettings(Security.validatePatch({ defaultCardType: msg.cardType }));
      return { ok: true };
    case 'GET_DECKS':
      return getDecks();
    case 'ADD_NOTE':
      return addNote(msg.note, sender);
    case 'TRANSLATE':
      return translate(msg.text, msg.context, msg.wide, msg.avoid);
    default:
      return { ok: false, code: 'FORBIDDEN', message: 'Request not allowed.' };
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        code: error.code ?? 'INVALID_REQUEST',
        message: error.message ?? 'Request failed.',
      });
    });
  return true;
});

api.runtime.onInstalled.addListener(async (details) => {
  await storageReady;
  await getSettings();
  await api.contextMenus.removeAll();
  api.contextMenus.create({
    id: 'wc-form',
    title: 'Add to Anki…',
    contexts: ['selection'],
    documentUrlPatterns: ['https://*/*', 'http://*/*'],
  });
  if (details.reason === 'install') api.tabs.create({ url: api.runtime.getURL('welcome.html') });
});
api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'wc-form' && tab?.id && Security.sitePattern(tab.url)) {
    api.tabs.sendMessage(tab.id, { type: 'OPEN_FORM' }).catch(() => {});
  }
});
api.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'open-clipper-form') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && Security.sitePattern(tab.url))
    api.tabs.sendMessage(tab.id, { type: 'OPEN_FORM' }).catch(() => {});
});

// Optional access is granted by the popup's explicit per-site permission request.
async function enableSite(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('Open a website first.');
  const tab = await api.tabs.get(tabId);
  const pattern = Security.sitePattern(tab.url);
  if (!pattern || !(await api.permissions.contains({ origins: [pattern] }))) {
    throw new Error('Site access was not granted.');
  }
  const id = `site-${encodeURIComponent(pattern)}`;
  const registered = await api.scripting.getRegisteredContentScripts({ ids: [id] });
  if (!registered.length) {
    await api.scripting.registerContentScripts([
      {
        id,
        matches: [pattern],
        js: ['context-extract.js', 'content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  }
  // Activate immediately without reloading the article. content.js guards duplicate injection.
  await api.scripting.executeScript({
    target: { tabId },
    files: ['context-extract.js', 'content.js'],
  });
  return { ok: true };
}
