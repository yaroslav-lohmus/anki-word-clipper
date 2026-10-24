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
async function init() {
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
