// Pure AnkiConnect helpers: request building, response interpretation,
// note-model definition. No fetch here — background.js owns HTTP.
const MODEL_NAME = 'Word Clipper';

const CARD_CSS = `
.card { font-family: "Segoe UI", -apple-system, sans-serif; font-size: 24px; text-align: center; }
.translation { margin-top: .2em; }
.context { margin-top: .9em; font-size: .75em; opacity: .75; }
.context b { color: #2fb890; }
.source { margin-top: 1.4em; font-size: .5em; opacity: .4; word-break: break-all; }
.forms { margin-top: .4em; font-size: .6em; opacity: .65; }
.context-translation { margin-top: .5em; font-size: .7em; opacity: .8; font-style: italic; }
`.trim();

function buildModelDef() {
  return {
    modelName: MODEL_NAME,
    // Forms/Example/OnlyReverse are last: modelFieldAdd appends, so migrated models match new ones
    inOrderFields: [
      'Word',
      'Translation',
      'Context',
      'Source',
      'AddReverse',
      'Forms',
      'Example',
      'OnlyReverse',
      'ContextTranslation',
    ],
    css: CARD_CSS,
    isCloze: false,
    cardTemplates: [
      {
        Name: 'Word → Translation',
        // {{^OnlyReverse}} suppresses the forward card for reverse-only notes
        Front: `{{^OnlyReverse}}<div class="word">{{Word}}</div>{{/OnlyReverse}}`,
        Back: `{{FrontSide}}<hr id="answer"><div class="translation">{{Translation}}</div><div class="forms">{{Forms}}</div><div class="context">{{Context}}</div>{{#ContextTranslation}}<div class="context-translation" lang="fi">{{ContextTranslation}}</div>{{/ContextTranslation}}`,
      },
      {
        Name: 'Translation → Word',
        Front: `{{#AddReverse}}<div class="word">{{Translation}}</div>{{/AddReverse}}`,
        Back: `{{FrontSide}}<hr id="answer"><div class="translation">{{Word}}</div><div class="forms">{{Forms}}</div><div class="context">{{Context}}</div>{{#ContextTranslation}}<div class="context-translation" lang="fi">{{ContextTranslation}}</div>{{/ContextTranslation}}`,
      },
    ],
  };
}
const MODEL_DEF = buildModelDef();

const CLOZE_MODEL_NAME = 'Word Clipper Cloze';

function buildClozeModelDef() {
  return {
    modelName: CLOZE_MODEL_NAME,
    inOrderFields: ['Text', 'Translation', 'Source', 'ContextTranslation'],
    css: `${CARD_CSS}\n.cloze { color: #2fb890; font-weight: bold; }`,
    isCloze: true,
    cardTemplates: [
      {
        Name: 'Cloze',
        Front: `<div class="context">{{cloze:Text}}</div>`,
        Back: `<div class="context">{{cloze:Text}}</div><hr id="answer"><div class="translation">{{Translation}}</div>{{#ContextTranslation}}<div class="context-translation" lang="fi">{{ContextTranslation}}</div>{{/ContextTranslation}}`,
      },
    ],
  };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function boldWord(contextEscaped, wordEscaped) {
  if (!wordEscaped) return contextEscaped;
  const idx = contextEscaped.toLowerCase().indexOf(wordEscaped.toLowerCase());
  if (idx === -1) return contextEscaped;
  return (
    contextEscaped.slice(0, idx) +
    '<b>' +
    contextEscaped.slice(idx, idx + wordEscaped.length) +
    '</b>' +
    contextEscaped.slice(idx + wordEscaped.length)
  );
}

// matchWord: the text as it appeared on the page (for bolding/cloze) when
// `word` was normalized to a dictionary headword by the AI provider.
function contextMeaning(translation, original, wordMeaning) {
  const clean = (value) =>
    String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('et');
  // Never show a second copy of the source sentence, even if the model ignores instructions.
  if (
    !clean(translation) ||
    clean(translation) === clean(original) ||
    clean(translation) === clean(wordMeaning)
  )
    return '';
  return escapeHtml(String(translation).trim());
}

function buildNoteFields({
  word,
  translation,
  context,
  source,
  reverse,
  onlyReverse,
  matchWord,
  forms,
  contextTranslation,
}) {
  const w = escapeHtml(String(word).trim());
  const m = escapeHtml(String(matchWord ?? word).trim());
  return {
    Word: w,
    Translation: escapeHtml(String(translation ?? '').trim()),
    Context:
      String(context ?? '').trim() === String(word).trim()
        ? ''
        : boldWord(escapeHtml(String(context ?? '').trim()), m),
    Source: escapeHtml(String(source ?? '')),
    AddReverse: reverse ? 'y' : '',
    Forms: escapeHtml(String(forms ?? '').trim()),
    Example: '', // Retained for compatibility; never render the old generated-example field.
    ContextTranslation: contextMeaning(contextTranslation, context, translation),
    OnlyReverse: onlyReverse ? 'y' : '',
  };
}

function buildClozeText(context, word) {
  const esc = escapeHtml(String(context ?? '').trim());
  const w = escapeHtml(String(word ?? '').trim());
  if (!esc) return `{{c1::${w}}}`;
  const idx = esc.toLowerCase().indexOf(w.toLowerCase());
  if (idx === -1) return `${esc}<br>{{c1::${w}}}`;
  return `${esc.slice(0, idx)}{{c1::${esc.slice(idx, idx + w.length)}}}${esc.slice(idx + w.length)}`;
}

function buildClozeNoteRequest(note) {
  return {
    action: 'addNote',
    version: 6,
    params: {
      note: {
        deckName: note.deck,
        modelName: CLOZE_MODEL_NAME,
        fields: {
          Text: buildClozeText(note.context, note.matchWord ?? note.word),
          Translation: escapeHtml(String(note.translation ?? '').trim()),
          Source: escapeHtml(String(note.source ?? '')),
          ContextTranslation: contextMeaning(
            note.contextTranslation,
            note.context,
            note.translation,
          ),
        },
        options: { allowDuplicate: !!note.allowDuplicate },
        tags: ['word-clipper'],
      },
    },
  };
}

function buildAddNoteRequest(note) {
  return {
    action: 'addNote',
    version: 6,
    params: {
      note: {
        deckName: note.deck,
        modelName: MODEL_NAME,
        fields: buildNoteFields(note),
        options: { allowDuplicate: !!note.allowDuplicate },
        tags: ['word-clipper'],
      },
    },
  };
}

function classifyAnkiError(message) {
  const m = String(message).toLowerCase();
  if (m.includes('duplicate')) return 'DUPLICATE';
  if (m.includes('deck') && m.includes('not found')) return 'DECK_MISSING';
  if (m.includes('model') && m.includes('not found')) return 'MODEL_MISSING';
  if (m.includes('permission') || m.includes('api key')) return 'PERMISSION_DENIED';
  return 'UNKNOWN';
}

function interpretResponse(json) {
  if (!json || typeof json !== 'object' || !('result' in json || 'error' in json)) {
    return { ok: false, code: 'UNKNOWN', message: 'Invalid AnkiConnect response' };
  }
  if (json.error != null) {
    return { ok: false, code: classifyAnkiError(json.error), message: String(json.error) };
  }
  return { ok: true, result: json.result };
}

const AnkiClient = {
  MODEL_NAME,
  MODEL_DEF,
  CLOZE_MODEL_NAME,
  buildModelDef,
  buildClozeModelDef,
  escapeHtml,
  boldWord,
  buildNoteFields,
  buildAddNoteRequest,
  buildClozeText,
  buildClozeNoteRequest,
  classifyAnkiError,
  interpretResponse,
};
if (typeof module !== 'undefined' && module.exports) module.exports = AnkiClient;
