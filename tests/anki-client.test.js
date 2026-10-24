const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../anki-client.js');

test('escapeHtml escapes &<>"', () => {
  assert.equal(A.escapeHtml(`a & <b> "c"`), 'a &amp; &lt;b&gt; &quot;c&quot;');
});

test('buildNoteFields maps reverse flag to AddReverse y/empty', () => {
  const base = { word: 'Haus', translation: 'talo', context: 'Das Haus ist alt.', source: 's' };
  assert.equal(A.buildNoteFields({ ...base, reverse: true }).AddReverse, 'y');
  assert.equal(A.buildNoteFields({ ...base, reverse: false }).AddReverse, '');
});

test('buildNoteFields bolds first case-insensitive occurrence of word in context', () => {
  const f = A.buildNoteFields({
    word: 'haus',
    translation: '',
    source: '',
    context: 'Das Haus ist alt.',
    reverse: false,
  });
  assert.equal(f.Context, 'Das <b>Haus</b> ist alt.');
});

test('buildNoteFields escapes HTML before bolding', () => {
  const f = A.buildNoteFields({
    word: 'x<y',
    translation: '',
    source: '',
    context: 'wert x<y hier',
    reverse: false,
  });
  assert.equal(f.Context, 'wert <b>x&lt;y</b> hier');
});

test('buildNoteFields leaves context unchanged when word absent', () => {
  const f = A.buildNoteFields({
    word: 'Hund',
    translation: '',
    source: '',
    context: 'Ohne Treffer.',
    reverse: false,
  });
  assert.equal(f.Context, 'Ohne Treffer.');
});

test('buildAddNoteRequest shape', () => {
  const r = A.buildAddNoteRequest({
    word: 'Haus',
    translation: 'talo',
    context: '',
    source: '',
    reverse: true,
    deck: 'Deutsch',
    allowDuplicate: true,
  });
  assert.equal(r.action, 'addNote');
  assert.equal(r.version, 6);
  assert.equal(r.params.note.deckName, 'Deutsch');
  assert.equal(r.params.note.modelName, 'Word Clipper');
  assert.deepEqual(r.params.note.tags, ['word-clipper']);
  assert.equal(r.params.note.options.allowDuplicate, true);
  assert.equal(r.params.note.fields.Word, 'Haus');
});

test('classifyAnkiError', () => {
  assert.equal(A.classifyAnkiError('cannot create note because it is a duplicate'), 'DUPLICATE');
  assert.equal(A.classifyAnkiError('deck was not found: Foo'), 'DECK_MISSING');
  assert.equal(A.classifyAnkiError('model was not found: Word Clipper'), 'MODEL_MISSING');
  assert.equal(A.classifyAnkiError('valid api key must be provided'), 'PERMISSION_DENIED');
  assert.equal(A.classifyAnkiError('something odd'), 'UNKNOWN');
});

test('interpretResponse', () => {
  assert.deepEqual(A.interpretResponse({ result: ['a'], error: null }), {
    ok: true,
    result: ['a'],
  });
  const err = A.interpretResponse({
    result: null,
    error: 'cannot create note because it is a duplicate',
  });
  assert.equal(err.ok, false);
  assert.equal(err.code, 'DUPLICATE');
  assert.equal(A.interpretResponse({}).ok, false);
  assert.equal(A.interpretResponse(null).ok, false);
});

test('MODEL_DEF has conditional reverse template and exact fields', () => {
  assert.deepEqual(A.MODEL_DEF.inOrderFields, [
    'Word',
    'Translation',
    'Context',
    'Source',
    'AddReverse',
    'Forms',
    'Example',
    'OnlyReverse',
    'ContextTranslation',
  ]);
  assert.equal(A.MODEL_DEF.modelName, 'Word Clipper');
  assert.equal(A.MODEL_DEF.cardTemplates.length, 2);
  const rev = A.MODEL_DEF.cardTemplates[1];
  assert.ok(rev.Front.startsWith('{{#AddReverse}}'));
  assert.ok(rev.Front.endsWith('{{/AddReverse}}'));
});

test('card templates contain no scripts, remote assets, or speech tags', () => {
  assert.ok(!/\{\{tts|<script|https?:\/\//.test(JSON.stringify(A.buildModelDef())));
});

test('buildNoteFields bolds by matchWord when word was normalized to headword', () => {
  const f = A.buildNoteFields({
    word: 'das Haus, die Häuser',
    translation: 'talo',
    source: '',
    context: 'In den Häusern ist es warm.',
    reverse: false,
    matchWord: 'Häusern',
  });
  assert.equal(f.Word, 'das Haus, die Häuser');
  assert.equal(f.Context, 'In den <b>Häusern</b> ist es warm.');
});

test('buildClozeText wraps the word occurrence, appends when absent', () => {
  assert.equal(
    A.buildClozeText('In den Häusern ist es warm.', 'Häusern'),
    'In den {{c1::Häusern}} ist es warm.',
  );
  assert.equal(A.buildClozeText('', 'Haus'), '{{c1::Haus}}');
  assert.equal(A.buildClozeText('Ohne Treffer.', 'Haus'), 'Ohne Treffer.<br>{{c1::Haus}}');
});

test('buildClozeNoteRequest uses cloze model and original word for the gap', () => {
  const r = A.buildClozeNoteRequest({
    word: 'das Haus, die Häuser',
    matchWord: 'Häusern',
    translation: 'talo',
    context: 'In den Häusern ist es warm.',
    source: 's',
    deck: 'Deutsch',
    allowDuplicate: false,
  });
  assert.equal(r.params.note.modelName, 'Word Clipper Cloze');
  assert.equal(r.params.note.fields.Text, 'In den {{c1::Häusern}} ist es warm.');
  assert.equal(r.params.note.fields.Translation, 'talo');
  assert.deepEqual(r.params.note.tags, ['word-clipper']);
});

test('cloze model def is isCloze with Text field first', () => {
  const d = A.buildClozeModelDef();
  assert.equal(d.modelName, 'Word Clipper Cloze');
  assert.equal(d.isCloze, true);
  assert.equal(d.inOrderFields[0], 'Text');
  assert.ok(d.cardTemplates[0].Front.includes('{{cloze:Text}}'));
});

test('buildNoteFields stores verb forms in the Forms field', () => {
  const f = A.buildNoteFields({
    word: 'verzögert',
    translation: 'viivyttää',
    context: '',
    source: '',
    reverse: false,
    forms: 'verzögern, verzögerte, hat verzögert',
  });
  assert.equal(f.Forms, 'verzögern, verzögerte, hat verzögert');
  assert.equal(f.Word, 'verzögert');
  assert.equal(
    A.buildNoteFields({ word: 'Haus', translation: '', context: '', source: '', reverse: false })
      .Forms,
    '',
  );
});

test('buildNoteFields stores Finnish sentence separately and ignores old examples', () => {
  const f = A.buildNoteFields({
    word: 'Haus',
    translation: '',
    context: '',
    source: '',
    reverse: false,
    example: 'Das Haus ist alt.',
    contextTranslation: 'Talo on vanha.',
  });
  assert.equal(f.Example, '');
  assert.equal(f.ContextTranslation, 'Talo on vanha.');
});

test('reverse-only: forward template is suppressed via OnlyReverse', () => {
  const fwd = A.MODEL_DEF.cardTemplates[0].Front;
  assert.ok(fwd.startsWith('{{^OnlyReverse}}'));
  assert.ok(fwd.endsWith('{{/OnlyReverse}}'));
  const f = A.buildNoteFields({
    word: 'Haus',
    translation: 'talo',
    context: '',
    source: '',
    reverse: true,
    onlyReverse: true,
  });
  assert.equal(f.AddReverse, 'y');
  assert.equal(f.OnlyReverse, 'y');
  assert.equal(
    A.buildNoteFields({ word: 'x', translation: '', context: '', source: '', reverse: true })
      .OnlyReverse,
    '',
  );
});

test('templates never render legacy examples and suppress untranslated duplicate context', () => {
  for (const def of [A.buildModelDef(), A.buildClozeModelDef()]) {
    assert.ok(!JSON.stringify(def.cardTemplates).includes('{{Example}}'));
    assert.ok(JSON.stringify(def.cardTemplates).includes('{{ContextTranslation}}'));
  }
  const f = A.buildNoteFields({
    word: 'tulipunkt',
    translation: 'polttopiste',
    context: 'Ka teistes tulipunktides.',
    contextTranslation: '  Ka teistes   tulipunktides.  ',
  });
  assert.equal(f.ContextTranslation, '');
});

test('whole-sentence cards do not repeat their front or Finnish meaning on the answer', () => {
  const f = A.buildNoteFields({
    word: 'Homme sajab vihma.',
    context: 'Homme sajab vihma.',
    translation: 'Huomenna sataa vettä.',
    contextTranslation: 'Huomenna sataa vettä.',
  });
  assert.equal(f.Context, '');
  assert.equal(f.ContextTranslation, '');
  assert.equal(f.Translation, 'Huomenna sataa vettä.');
});
