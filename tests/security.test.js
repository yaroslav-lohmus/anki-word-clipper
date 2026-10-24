const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../security.js');
const runtime = {
  id: 'test-extension',
  getURL: (file) => `chrome-extension://test-extension/${file}`,
};
const popup = { id: runtime.id, url: runtime.getURL('popup.html') };
const content = {
  id: runtime.id,
  frameId: 0,
  url: 'https://www.err.ee/article',
  tab: { id: 1, url: 'https://www.err.ee/article', title: 'ERR article' },
};

function harness(initialSettings = {}, failStorage = false, fetchImpl) {
  let stored = structuredClone(initialSettings);
  const calls = [];
  let accessLevel;
  const api = {
    runtime: { ...runtime, onMessage: { addListener() {} }, onInstalled: { addListener() {} } },
    storage: {
      local: {
        async setAccessLevel(options) {
          accessLevel = options.accessLevel;
          if (failStorage) throw new Error('Storage protection failed');
        },
        async get() {
          return { settings: structuredClone(stored) };
        },
        async set(value) {
          stored = structuredClone(value.settings);
        },
      },
    },
    tabs: { query: async () => [], sendMessage: async () => {} },
    contextMenus: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
  };
  const context = vm.createContext({
    chrome: api,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    AnkiClient: require('../anki-client.js'),
    Translator: require('../translator.js'),
    Security: S,
    importScripts() {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"headword":"raamat","translation":"kirja"}' } }],
        }),
      };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  return {
    request: (message, sender = popup) => context.handleMessage(message, sender),
    calls,
    get stored() {
      return stored;
    },
    get accessLevel() {
      return accessLevel;
    },
  };
}

test('trust boundary allows only popup and top-frame ERR scripts', () => {
  assert.equal(S.senderRole(popup, runtime), 'popup');
  assert.equal(S.senderRole(content, runtime), 'content');
  for (const sender of [
    undefined,
    { ...popup, id: 'other' },
    { ...popup, tab: { id: 1 } },
    { ...content, frameId: 2 },
    { ...content, url: 'https://err.ee.attacker.invalid/' },
    { ...content, url: 'http://err.ee/' },
  ]) {
    assert.equal(S.senderRole(sender, runtime), null);
  }
});

test('content scripts cannot read keys, change credentials, run tests, or invoke removed actions', async () => {
  const h = harness({ aiKey: 'secret-test-key' });
  assert.equal(h.accessLevel, 'TRUSTED_CONTEXTS');
  for (const sender of [popup, content]) {
    const res = await h.request({ type: 'GET_SETTINGS' }, sender);
    assert.ok(!JSON.stringify(res).includes('secret-test-key'));
    assert.equal(res.settings.aiKey, undefined);
  }
  for (const type of ['SET_SETTINGS', 'TEST_AI', 'BATCH', 'CHECK_CONNECTION']) {
    const res = await h.request({ type, patch: { aiKey: 'new-key' } }, content);
    assert.equal(res.code, 'FORBIDDEN');
  }
  assert.equal(h.stored.aiKey, 'secret-test-key');
  assert.equal(h.calls.length, 0);
});

test('unsupported origins are rejected before data access or network calls', async () => {
  const h = harness();
  const res = await h.request(
    { type: 'TRANSLATE', text: 'raamat' },
    { ...content, url: 'https://attacker.invalid' },
  );
  assert.equal(res.code, 'FORBIDDEN');
  assert.equal(h.calls.length, 0);
});

test('endpoint overrides, unknown models, header injection and oversized input are rejected', async () => {
  const h = harness();
  for (const patch of [
    { aiBaseUrl: 'https://attacker.invalid' },
    { aiKey: 'key\r\nInjected: yes' },
    { aiModel: 'unknown' },
    { autoTranslate: 'yes' },
    { __proto__: null, arbitrary: true },
  ]) {
    await assert.rejects(h.request({ type: 'SET_SETTINGS', patch }));
  }
  await assert.rejects(h.request({ type: 'TRANSLATE', text: 'x'.repeat(2001) }, content));
  assert.equal(h.calls.length, 0);
});

test('legacy upgrade drops provider keys and disables automatic translation', async () => {
  const h = harness({
    aiKey: 'google-key',
    aiKeys: { gemini: 'google-key' },
    aiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    engine: 'ai',
    autoTranslate: true,
  });
  await h.request({ type: 'GET_SETTINGS' });
  assert.equal(h.stored.aiKey, '');
  assert.equal(h.stored.autoTranslate, false);
  assert.equal(h.stored.aiKeys, undefined);
  assert.equal(h.stored.aiBaseUrl, undefined);
  const openrouter = harness({
    aiKey: 'router-key',
    aiBaseUrl: 'https://openrouter.ai/api/v1',
    autoTranslate: true,
  });
  await openrouter.request({ type: 'GET_SETTINGS' });
  assert.equal(openrouter.stored.aiKey, 'router-key');
  assert.equal(openrouter.stored.autoTranslate, false);
});

test('translation is opt-in, sends only to OpenRouter, and never falls back', async () => {
  const off = harness({ aiKey: 'test' });
  assert.equal(
    (await off.request({ type: 'TRANSLATE', text: 'raamat' }, content)).code,
    'DISABLED',
  );
  assert.equal(off.calls.length, 0);
  const h = harness({ aiKey: 'test', autoTranslate: true }, false, async () => ({
    ok: false,
    status: 429,
  }));
  const res = await h.request({ type: 'TRANSLATE', text: 'raamat' }, content);
  assert.equal(res.ok, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(h.calls[0].options.redirect, 'error');
  assert.ok(!h.calls[0].options.body.includes(content.url));
});

test('storage restriction failure prevents reading credentials or translating', async () => {
  const h = harness({ aiKey: 'test' }, true);
  await assert.rejects(h.request({ type: 'GET_SETTINGS' }), /Storage protection failed/);
  assert.equal(h.calls.length, 0);
});

test('card creation escapes hostile HTML and uses the actual source URL', async () => {
  const h = harness({}, false, async (_url, options) => {
    const req = JSON.parse(options.body);
    const values = {
      requestPermission: { permission: 'granted' },
      modelNames: [],
      createModel: true,
      addNote: 123,
    };
    return { ok: true, json: async () => ({ result: values[req.action], error: null }) };
  });
  const res = await h.request(
    {
      type: 'ADD_NOTE',
      note: {
        word: '<img src=x onerror=alert(1)>',
        translation: '<script>bad()</script>',
        deck: 'Estonian',
        cardType: 'basic',
        source: 'fake-url',
      },
    },
    content,
  );
  assert.equal(res.ok, true);
  const saved = h.calls
    .map((call) => JSON.parse(call.options.body))
    .find((req) => req.action === 'addNote').params.note;
  assert.ok(!saved.fields.Word.includes('<img'));
  assert.ok(!saved.fields.Translation.includes('<script'));
  assert.equal(saved.fields.Source, 'ERR article — https://www.err.ee/article');
});

test('manifest grants only ERR page access and the two required network origins', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json')));
  assert.deepEqual(manifest.host_permissions, [
    'http://127.0.0.1:8765/*',
    'https://openrouter.ai/*',
  ]);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://err.ee/*', 'https://*.err.ee/*']);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.externally_connectable, undefined);
});
