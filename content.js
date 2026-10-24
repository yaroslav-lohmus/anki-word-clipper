// Repeated per-site activation must not attach duplicate forms or event listeners.
(() => {
  if (globalThis.__wordClipperLoaded) return;
  globalThis.__wordClipperLoaded = true;
  const api = globalThis.browser ?? globalThis.chrome;
  const MAX_SEL_LEN = 2000;

  const ERROR_TEXT = {
    ANKI_UNREACHABLE: 'Anki is unavailable. Open Anki with AnkiConnect.',
    PERMISSION_DENIED: 'Access denied. Click Yes in Anki.',
    DUPLICATE: 'Already in this deck',
    DECK_MISSING: 'Deck not found. Refresh the list.',
    MODEL_MISSING: 'Card type not found. Open extension settings.',
    UNKNOWN: 'Anki error',
  };
  const errText = (res) => {
    if (
      String(res?.message ?? '')
        .toLowerCase()
        .includes('context invalidated')
    ) {
      return 'Extension updated. Reload this page.';
    }
    return ERROR_TEXT[res?.code] ?? res?.message ?? ERROR_TEXT.UNKNOWN;
  };

  // async wrapper also catches the synchronous throw that happens when the
  // extension was reloaded and this page still runs the old content script
  const send = async (msg) => {
    try {
      return await api.runtime.sendMessage(msg);
    } catch (e) {
      return { ok: false, code: 'UNKNOWN', message: String(e?.message ?? e) };
    }
  };

  const CSS = `
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, input, textarea, select { font: inherit; color: inherit; }
    button { cursor: pointer; transition: background .15s; }
    :focus-visible { outline: 2px solid #35634e; outline-offset: 3px; }
    .wc-btn { position: fixed; display: none; z-index: 2147483647; background: #fff; color: #35634e;
      border: 1px solid #cbd8cf; border-radius: 5px; padding: 5px 10px; font-size: 12px; font-weight: 600;
      box-shadow: 0 2px 8px #25312d14; }
    .wc-btn.show { display: block; }
    .wc-btn:hover { background: #edf3ef; }
    .wc-form { position: fixed; display: none; z-index: 2147483647; width: 340px; max-width: calc(100vw - 16px);
      max-height: calc(100dvh - 16px); overflow-y: auto; color-scheme: light; background: #fff; color: #25312d;
      border: 1px solid #dce2de; border-radius: 10px; padding: 18px; font-size: 13px;
      box-shadow: 0 6px 28px #25312d1a; line-height: 1.5; }
    .wc-form.show { display: block; }
    .wc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
      font-size: 15px; font-weight: 600; letter-spacing: -.02em; cursor: move; user-select: none; touch-action: none; }
    .wc-x { background: transparent; border: 0; border-radius: 4px; padding: 1px 6px; color: #65716b; font-size: 20px; }
    .wc-x:hover { background: #f3f5f3; }
    label { display: block; margin: 12px 0 5px; font-size: 12px; font-weight: 500; }
    input[type=text], textarea, select { display: block; width: 100%; background: #fff; color: #25312d;
      border: 1px solid #dce2de; border-radius: 5px; padding: 8px 9px; font-size: 13px; }
    input::placeholder, textarea::placeholder { color: #76817b; opacity: 1; }
    textarea { resize: vertical; min-height: 60px; }
    .wc-meaning-head { display: flex; align-items: baseline; justify-content: space-between; }
    .wc-rr { background: transparent; border: 0; padding: 2px 0; color: #35634e; font-size: 11px; }
    .wc-rr:hover { text-decoration: underline; }
    .wc-note { font-size: 12px; color: #65716b; margin-top: 7px; overflow-wrap: anywhere; }
    .wc-note:empty { display: none; }
    .wc-options { margin-top: 14px; padding-top: 12px; border-top: 1px solid #edf0ed; }
    summary { width: fit-content; font-size: 12px; color: #65716b; cursor: pointer; }
    .wc-row { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
    .wc-add { flex: none; background: #35634e; color: #fff; border: 0; border-radius: 5px; padding: 9px 14px; font-size: 13px; font-weight: 550; }
    .wc-add:hover { background: #294e3d; }
    .wc-add:active { transform: translateY(1px); }
    .wc-add:disabled { opacity: .55; cursor: default; }
    .wc-status { color: #65716b; font-size: 12px; overflow-wrap: anywhere; }
    .wc-status.err { color: #a1342b; }
    .wc-status button { background: transparent; border: 0; color: #35634e; padding: 0; font-size: 12px; text-decoration: underline; }
    .wc-toast { position: fixed; right: 18px; bottom: 18px; display: none; z-index: 2147483647;
      background: #fff; color: #25312d; border: 1px solid #dce2de; border-radius: 6px;
      padding: 10px 14px; font-size: 13px; box-shadow: 0 4px 20px #25312d14; }
    .wc-toast.show { display: flex; gap: 10px; align-items: center; }
    .wc-toast button { background: transparent; border: 0; color: #35634e; font-size: 12px; text-decoration: underline; padding: 0; }
  `;

  let host, shadow, btn, form, toast, toastTimer;
  let lastCapture = null;
  let currentCapture = null;

  const q = (sel) => form.querySelector(sel);

  // ---------- capture ----------

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX_SEL_LEN) return null;
    const node = sel.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el || el.closest("input, textarea, [contenteditable=''], [contenteditable=true]"))
      return null;
    return { text, range: sel.getRangeAt(0) };
  }

  const BLOCK =
    'p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, article, section, div, body';

  function blockTextAround(range) {
    const c = range.startContainer;
    const el = (c instanceof Element ? c : c.parentElement)?.closest(BLOCK);
    if (!el) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '',
      selStart = -1,
      selEnd = -1,
      n;
    while ((n = walker.nextNode())) {
      if (n === range.startContainer) selStart = text.length + range.startOffset;
      if (n === range.endContainer) selEnd = text.length + range.endOffset;
      text += n.nodeValue;
    }
    return selStart >= 0 && selEnd >= selStart ? { text, selStart, selEnd } : null;
  }

  function capture() {
    const info = selectionInfo();
    if (!info) return null;
    let context = '',
      wideContext = '';
    const block = blockTextAround(info.range);
    if (block) {
      const c = ContextExtract.extractContext(block.text, block.selStart, block.selEnd);
      context = (c.before + c.word + c.after).replace(/\s+/g, ' ').trim();
      // ±1 sentence around — goes to the AI for disambiguation, not to the card
      // ponytail: window is limited to the same block element; cross-paragraph neighbours are out
      const w = ContextExtract.extractContext(block.text, block.selStart, block.selEnd, 700, 2);
      wideContext = (w.before + w.word + w.after).replace(/\s+/g, ' ').trim();
    }
    return {
      word: info.text,
      context,
      wideContext,
      source: `${document.title} — ${location.href}`,
      rect: info.range.getBoundingClientRect(),
    };
  }

  // ---------- UI scaffolding ----------

  function ensureUi() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText =
      'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;

    btn = document.createElement('button');
    btn.className = 'wc-btn';
    btn.textContent = '+ Anki';
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onButton();
    });

    form = document.createElement('div');
    form.className = 'wc-form';
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-labelledby', 'wc-title');
    form.innerHTML = `
      <div class="wc-head"><span id="wc-title">Add to Anki</span><button type="button" class="wc-x" aria-label="Close" title="Close">×</button></div>
      <label for="wc-word">Estonian</label><input id="wc-word" type="text" class="wc-word" autocomplete="off">
      <div class="wc-meaning-head"><label for="wc-meaning">Finnish meaning</label><button type="button" class="wc-rr">Translate again</button></div>
      <input id="wc-meaning" type="text" class="wc-tr" placeholder="Enter a meaning" autocomplete="off">
      <div class="wc-note" role="status"></div>
      <label for="wc-deck">Deck</label><select id="wc-deck" class="wc-deck"></select>
      <details class="wc-options"><summary>More options</summary>
        <label for="wc-sentence">Original sentence</label><textarea id="wc-sentence" class="wc-ctx" rows="2"></textarea>
        <label for="wc-context-translation">Finnish sentence</label><textarea id="wc-context-translation" class="wc-context-tr" rows="2"></textarea>
        <label for="wc-type">Card type</label><select id="wc-type" class="wc-type">
          <option value="basic">Word → meaning</option><option value="reverse">Both directions</option>
          <option value="reverseOnly">Meaning → word</option><option value="cloze">Missing word</option>
        </select>
      </details>
      <div class="wc-row"><button type="button" class="wc-add">Save to Anki</button><span class="wc-status" role="status"></span></div>
    `;
    form.querySelector('.wc-x').addEventListener('click', closeForm);
    form.querySelector('.wc-add').addEventListener('click', () => submit(false));
    form.querySelector('.wc-rr').addEventListener('click', (e) => {
      e.preventDefault();
      const avoid = q('.wc-tr').value;
      trEdited = false;
      requestTranslation(q('.wc-word').value, avoid);
    });

    // re-translate when the word is edited by hand; stop auto-filling once
    // the user typed their own translation
    const wordInput = form.querySelector('.wc-word');
    const trInput = form.querySelector('.wc-tr');
    let wordTimer;
    trInput.addEventListener('input', () => {
      trEdited = true;
    });
    wordInput.addEventListener('input', () => {
      clearTimeout(wordTimer);
      wordTimer = setTimeout(() => {
        if (!trEdited) requestTranslation(wordInput.value);
      }, 600);
    });

    // context textarea grows to its content while focused
    const ctxInput = form.querySelector('.wc-ctx');
    ctxInput.addEventListener('input', () => {
      q('.wc-context-tr').value = '';
    });
    ctxInput.addEventListener('focus', () => {
      ctxInput.style.height = 'auto';
      ctxInput.style.height = `${Math.min(ctxInput.scrollHeight + 2, 180)}px`;
    });
    ctxInput.addEventListener('blur', () => {
      ctxInput.style.height = '';
    });

    // drag the form by its header
    const head = form.querySelector('.wc-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.wc-x')) return;
      const r = form.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const move = (ev) => {
        form.style.left = `${Math.max(0, Math.min(ev.clientX - dx, innerWidth - 60))}px`;
        form.style.top = `${Math.max(0, Math.min(ev.clientY - dy, innerHeight - 40))}px`;
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
      };
      head.setPointerCapture(e.pointerId);
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      e.preventDefault();
    });
    form.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep page hotkeys away from our form
      if (e.key === 'Escape') closeForm();
      if (
        e.key === 'Enter' &&
        (e.target.tagName === 'INPUT' ||
          (e.target.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)))
      ) {
        e.preventDefault();
        submit(false);
      }
    });

    toast = document.createElement('div');
    toast.className = 'wc-toast';

    shadow.append(style, btn, form, toast);
    document.documentElement.append(host);
  }

  // ---------- button ----------

  function hideButton() {
    if (btn) btn.classList.remove('show');
  }
  const formOpen = () => form?.classList.contains('show');

  function maybeShowButton() {
    ensureUi();
    if (formOpen()) return;
    setTimeout(() => {
      const cap = capture();
      if (!cap) {
        hideButton();
        return;
      }
      lastCapture = cap;
      btn.style.left = `${Math.min(cap.rect.right + 6, innerWidth - 80)}px`;
      btn.style.top = `${Math.max(cap.rect.top - 34, 4)}px`;
      btn.classList.add('show');
    }, 10);
  }

  document.addEventListener('mouseup', (e) => {
    if (!host || e.composedPath()[0] !== host) maybeShowButton();
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.shiftKey) maybeShowButton();
  });
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if ((!sel || sel.isCollapsed) && !formOpen()) hideButton();
  });
  // Click outside the form to close it.
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!e.composedPath().includes(host)) {
        if (formOpen()) closeForm();
      }
    },
    true,
  );
  window.addEventListener('scroll', hideButton, { passive: true, capture: true });

  function onButton() {
    hideButton();
    openForm(lastCapture);
  }

  // ---------- form ----------

  async function openForm(cap) {
    if (!cap) return;
    ensureUi();
    currentCapture = cap;
    trEdited = false;
    aiForms = '';
    aiContextTranslation = '';
    q('.wc-word').value = cap.word;
    q('.wc-tr').value = '';
    q('.wc-ctx').value = cap.context;
    q('.wc-context-tr').value = '';
    q('.wc-options').open = false;
    q('.wc-note').textContent = '';
    setStatus('');
    const left = Math.max(8, Math.min(cap.rect.left, innerWidth - 356));
    const top =
      cap.rect.bottom + 8 + 340 < innerHeight
        ? cap.rect.bottom + 8
        : Math.max(8, cap.rect.top - 348);
    form.style.left = `${left}px`;
    form.style.top = `${top}px`;
    form.classList.add('show');

    const st = await send({ type: 'GET_SETTINGS' });
    q('.wc-type').value = st?.settings?.defaultCardType ?? 'basic';
    q('.wc-tr').focus();
    requestTranslation(cap.word);

    const deckSel = q('.wc-deck');
    q('.wc-add').disabled = true;
    deckSel.innerHTML = '<option>Loading decks…</option>';
    const res = await send({ type: 'GET_DECKS' });
    if (!res.ok) {
      deckSel.innerHTML = "<option value=''>—</option>";
      setStatus(errText(res), true, { label: 'Retry', fn: () => openForm(currentCapture) });
      return;
    }
    deckSel.innerHTML = '';
    for (const d of res.decks) {
      const o = document.createElement('option');
      o.value = o.textContent = d;
      deckSel.append(o);
    }
    if (res.lastDeck && res.decks.includes(res.lastDeck)) deckSel.value = res.lastDeck;
    q('.wc-add').disabled = !res.decks.length;
    if (!res.decks.length) setStatus('Create a deck in Anki, then reopen this form.', true);
    q('.wc-tr').focus();
  }

  function closeForm() {
    form?.classList.remove('show');
    currentCapture = null;
  }

  // Fill the translation field asynchronously; never overwrite what the
  // user already typed, and ignore stale responses after a reopen. With an AI
  // provider we also get a dictionary headword (put into Word) and a short
  // grammar note (shown as a hint).
  let translateSeq = 0;
  let trEdited = false; // user typed their own translation — never overwrite it
  let aiForms = ''; // verb principal forms from the AI — saved into the Forms field
  let aiContextTranslation = ''; // Finnish translation of the original sentence
  async function requestTranslation(word, avoid = '') {
    if (!word?.trim()) return;
    const seq = ++translateSeq;
    const tr = q('.wc-tr');
    if (avoid) tr.value = '';
    tr.placeholder = 'Translating…';
    const res = await send({
      type: 'TRANSLATE',
      text: word,
      context: q('.wc-ctx').value,
      wide: currentCapture?.wideContext ?? '',
      avoid,
    });
    if (seq !== translateSeq || !formOpen()) return;
    tr.placeholder = 'Enter a meaning';
    if (!res.ok) {
      q('.wc-note').textContent =
        res.message || 'Translation unavailable; you can enter a meaning yourself.';
      return;
    }
    if (!trEdited) tr.value = res.translation;
    if (res.provider === 'ai') {
      aiForms = res.forms ?? '';
      aiContextTranslation = res.contextTranslation ?? '';
      q('.wc-context-tr').value = aiContextTranslation;
      // Keep the original inflection in matchWord and save the dictionary form.
      if (res.headword && !trEdited) q('.wc-word').value = res.headword;
      q('.wc-note').textContent = [aiForms, res.note].filter(Boolean).join(' · ');
    }
  }

  function setStatus(text, isErr = false, action = null) {
    const box = q('.wc-status');
    box.className = `wc-status${isErr ? ' err' : ''}`;
    box.textContent = text;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.addEventListener('click', action.fn);
      box.append(' ', b);
    }
  }

  async function submit(allowDuplicate) {
    const cardType = q('.wc-type').value;
    const note = {
      word: q('.wc-word').value,
      matchWord: currentCapture?.word ?? q('.wc-word').value, // the form in the sentence
      translation: q('.wc-tr').value,
      context: q('.wc-ctx').value,
      source: currentCapture?.source ?? `${document.title} — ${location.href}`,
      forms: aiForms,
      contextTranslation: q('.wc-context-tr').value,
      cardType,
      deck: q('.wc-deck').value,
      allowDuplicate,
    };
    if (!note.word.trim()) return setStatus('Enter a word', true);
    if (!note.deck) return setStatus('Choose a deck', true);
    if (cardType === 'cloze' && !note.context.trim()) {
      return setStatus('Cloze cards need a sentence', true);
    }
    q('.wc-add').disabled = true;
    setStatus('Adding…');
    const res = await send({ type: 'ADD_NOTE', note });
    q('.wc-add').disabled = false;
    if (res.ok) {
      send({ type: 'SET_CARD_TYPE', cardType });
      closeForm();
      showToast('Added to Anki ✓');
    } else if (res.code === 'DUPLICATE') {
      setStatus('Already in this deck', true, { label: 'Add anyway', fn: () => submit(true) });
    } else {
      setStatus(errText(res), true); // form stays open, input preserved
    }
  }

  // ---------- toast ----------

  function showToast(text, action = null) {
    ensureUi();
    clearTimeout(toastTimer);
    toast.textContent = text;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.addEventListener('click', () => {
        hideToast();
        action.fn();
      });
      toast.append(b);
    }
    toast.classList.add('show');
    toastTimer = setTimeout(hideToast, action ? 7000 : 2500);
  }

  function hideToast() {
    toast?.classList.remove('show');
  }

  // ---------- external triggers (context menu / hotkey) ----------

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'OPEN_FORM') {
      const c = capture() ?? lastCapture;
      if (c) openForm(c);
    }
  });
})();
