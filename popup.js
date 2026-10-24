const api = chrome;
const $ = (id) => document.getElementById(id);
async function send(message) {
  try {
    return await api.runtime.sendMessage(message);
  } catch {
    return { ok: false, message: 'Extension unavailable. Reload the extension and try again.' };
  }
}
async function save(patch) {
  const res = await send({ type: 'SET_SETTINGS', patch });
  if (!res.ok) $('key-status').textContent = res.message;
  return res;
}
async function check() {
  $('status').textContent = 'Checking Anki…';
  const res = await send({ type: 'CHECK_CONNECTION' });
  $('status').className = res.ok ? 'ok' : 'err';
  $('status').textContent = res.ok ? 'Anki connected' : res.message;
  $('help').hidden = res.ok;
}
async function refresh() {
  const res = await send({ type: 'GET_SETTINGS' });
  if (!res.ok) {
    $('key-status').textContent = res.message;
    return;
  }
  const s = res.settings;
  $('cardtype').value = s.defaultCardType;
  $('autotr').checked = s.autoTranslate;
  $('model').value = s.aiModel;
  $('key-status').textContent = s.hasApiKey ? 'An API key is saved.' : 'No API key saved.';
}
let activeTab;
async function refreshSite() {
  try {
    [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
    const pattern = Security.sitePattern(activeTab?.url);
    if (!pattern) {
      $('site-status').textContent = 'Open a regular website to capture words.';
      return;
    }
    const allowed = await api.permissions.contains({ origins: [pattern] });
    const url = new URL(activeTab.url);
    const builtIn =
      url.protocol === 'https:' && (url.hostname === 'err.ee' || url.hostname.endsWith('.err.ee'));
    const registered = await api.scripting.getRegisteredContentScripts({
      ids: [`site-${encodeURIComponent(pattern)}`],
    });
    const enabled = allowed && (builtIn || registered.length > 0);
    $('enable-site').hidden = enabled;
    $('site-status').textContent = enabled
      ? 'Enabled on this site.'
      : 'Allow access here to capture words.';
  } catch {
    $('site-status').textContent = 'Open a website and reopen this popup.';
  }
}
async function init() {
  $('enable-site').addEventListener('click', async () => {
    const pattern = Security.sitePattern(activeTab?.url);
    if (!pattern) return;
    try {
      // Must be invoked directly from the user gesture, before any other awaits.
      const granted = await api.permissions.request({ origins: [pattern] });
      if (!granted) {
        $('site-status').textContent = 'Site access was not granted.';
        return;
      }
      const res = await send({ type: 'ENABLE_SITE', tabId: activeTab.id });
      if (!res.ok) {
        $('site-status').textContent = res.message;
        return;
      }
      await refreshSite();
    } catch {
      $('site-status').textContent = 'Cannot enable this page. Try a regular website.';
    }
  });
  await refreshSite();
  await refresh();
  $('cardtype').addEventListener('change', () => save({ defaultCardType: $('cardtype').value }));
  $('autotr').addEventListener('change', () => save({ autoTranslate: $('autotr').checked }));
  $('model').addEventListener('change', () => save({ aiModel: $('model').value }));
  $('save-key').addEventListener('click', async () => {
    const key = $('aikey').value.trim();
    if (!key) {
      $('key-status').textContent = 'Enter a key to save it.';
      return;
    }
    if ((await save({ aiKey: key })).ok) {
      $('aikey').value = '';
      await refresh();
    }
  });
  $('clear-key').addEventListener('click', async () => {
    if ((await save({ aiKey: '' })).ok) {
      $('aikey').value = '';
      await refresh();
    }
  });
  $('aitest').addEventListener('click', async () => {
    $('aitest-res').textContent = 'Testing translation…';
    const res = await send({ type: 'TEST_AI' });
    $('aitest-res').textContent = res.ok
      ? `${res.sample.headword || 'raamat'} — ${res.sample.translation}`
      : res.message;
  });
  $('retry').addEventListener('click', check);
  await check();
}
init();
