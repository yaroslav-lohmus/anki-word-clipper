const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../translator.js');
const wrap = (value) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });

test('translation always uses OpenRouter, Finnish, bounded output, and no redirects', () => {
  const req = T.buildAiRequest({
    baseUrl: 'https://attacker.invalid',
    apiKey: 'test-only',
    model: 'google/gemini-3.1-flash-lite',
    word: 'raamatut',
    context: 'Ma loen raamatut.',
  });
  assert.equal(req.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(req.options.redirect, 'error');
  assert.equal(req.options.credentials, 'omit');
  assert.equal(req.options.headers.Authorization, 'Bearer test-only');
  const body = JSON.parse(req.options.body);
  assert.equal(body.max_tokens, 900);
  assert.match(body.messages[0].content, /Finnish/);
  assert.match(body.messages[0].content, /untrusted quoted data/);
  assert.deepEqual(JSON.parse(body.messages[1].content), {
    selection: 'raamatut',
    sentence: 'Ma loen raamatut.',
    surroundingSentences: '',
    rejectedTranslation: '',
  });
});

test('strict parsing rejects malformed, mistyped, and oversized output', () => {
  for (const output of [
    null,
    {},
    [],
    { translation: '' },
    { translation: {} },
    { translation: 'kirja', headword: {} },
    { translation: 'x'.repeat(2001) },
  ]) {
    assert.equal(T.parseAiResponse(wrap(output)), null);
  }
  assert.equal(
    T.parseAiResponse({ choices: [{ message: { content: '```json\n{}\n```' } }] }),
    null,
  );
  assert.deepEqual(T.parseAiResponse(wrap({ headword: 'raamat', translation: 'kirja' })), {
    headword: 'raamat',
    translation: 'kirja',
    forms: null,
    note: null,
    contextTranslation: null,
  });
});

test('sentence translation is explicit and legacy copied examples cannot enter parsed output', () => {
  const req = T.buildAiRequest({
    apiKey: 'test',
    model: 'test',
    word: 'tulipunktides',
    context: 'Ka teistes tulipunktides.',
  });
  assert.match(
    JSON.parse(req.options.body).messages[0].content,
    /contextTranslation: translate the supplied sentence fully/,
  );
  const parsed = T.parseAiResponse(
    wrap({
      headword: 'tulipunkt',
      translation: 'polttopiste',
      contextTranslation: 'Myös muissa polttopisteissä.',
      example: 'Ka teistes tulipunktides.',
    }),
  );
  assert.equal(parsed.contextTranslation, 'Myös muissa polttopisteissä.');
  assert.equal(parsed.example, undefined);
});
