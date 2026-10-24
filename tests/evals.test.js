const { test } = require('node:test');
const assert = require('node:assert/strict');
const Provider = require('../evals/provider.cjs');
const prompt = require('../evals/prompt.cjs');
const { grade } = require('../evals/assertions.cjs');
const cases = require('../evals/cases.cjs');
const { buildAiRequest } = require('../translator.js');

test('eval prompt is the production request body, without credentials', () => {
  const vars = { word: 'raamatut', context: 'Ma loen raamatut.' };
  const actual = prompt({ vars });
  assert.equal(
    actual,
    buildAiRequest({ apiKey: '', model: 'selected-by-provider', ...vars }).options.body,
  );
  assert.ok(!actual.includes('Authorization'));
});

test('seed cases have unique IDs, bounded inputs and explicit expectations', () => {
  assert.equal(new Set(cases.map((value) => value.id)).size, cases.length);
  for (const value of cases) {
    assert.ok(value.word && value.word.length <= 2000);
    assert.ok(value.context.length <= 3000);
    assert.ok(value.headwords.length && value.meanings.length);
  }
});

test('grading catches wrong senses, wrong headwords, malformed output and HTML', () => {
  const expected = cases.find((value) => value.id === 'false-friend-mould');
  assert.equal(
    grade(
      {
        headword: 'hallitus',
        translation: 'home',
        contextTranslation: 'Kostealla seinällä kasvaa hometta.',
      },
      expected,
    ).pass,
    true,
  );
  assert.equal(grade({ headword: 'hallitus', translation: 'hallitus' }, expected).pass, false);
  assert.equal(
    grade(
      {
        headword: 'home',
        translation: 'home',
        contextTranslation: 'Kostealla seinällä kasvaa hometta.',
      },
      expected,
    ).pass,
    false,
  );
  assert.equal(grade('bad JSON', expected).pass, false);
  assert.equal(grade({ headword: 'hallitus', translation: '<b>home</b>' }, expected).pass, false);
  assert.equal(
    grade(
      {
        headword: null,
        translation: 'Huomenna sataa vettä.',
        contextTranslation: 'Huomenna sataa vettä.',
      },
      cases.find((value) => value.id === 'full-sentence'),
    ).pass,
    true,
  );
});

test('evaluation rejects copied source sentences instead of Finnish context translations', () => {
  const expected = cases.find((value) => value.id === 'tulipunkt-context-regression');
  assert.equal(
    grade(
      { headword: 'tulipunkt', translation: 'polttopiste', contextTranslation: expected.context },
      expected,
    ).pass,
    false,
  );
  assert.equal(grade({ headword: 'tulipunkt', translation: 'polttopiste' }, expected).pass, false);
});

test('offline smoke uses synthetic transport and cannot call a model', async () => {
  const provider = new Provider({
    config: { offline: true },
    fetchImpl: () => {
      throw new Error('Network must not run');
    },
  });
  const result = await provider.callApi(prompt({ vars: cases[0] }));
  assert.equal(result.metadata.offline, true);
  assert.equal(grade(result.output, cases[0]).pass, true);
});

test('live adapter shares production parser, reports billed usage and redacts secrets', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'synthetic-key-for-adapter-test';
  try {
    let called = 0;
    const provider = new Provider({
      fetchImpl: async (url, options) => {
        called++;
        assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer synthetic-key-for-adapter-test');
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"headword":"raamat","translation":"kirja"}' } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.000055 },
          }),
        };
      },
    });
    const result = await provider.callApi(prompt({ vars: cases[0] }));
    assert.equal(called, 1);
    assert.equal(result.cost, 0.000055);
    assert.equal(result.tokenUsage.total, 120);
    assert.ok(!JSON.stringify(result).includes(process.env.OPENROUTER_API_KEY));
    const broken = new Provider({
      fetchImpl: async () => {
        throw new Error(process.env.OPENROUTER_API_KEY);
      },
    });
    const failure = await broken.callApi(prompt({ vars: cases[0] }));
    assert.ok(failure.error);
    assert.ok(!JSON.stringify(failure).includes(process.env.OPENROUTER_API_KEY));
    const invalid = new Provider({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'bad JSON' } }] }),
      }),
    });
    assert.match((await invalid.callApi(prompt({ vars: cases[0] }))).error, /parser rejected/);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test('DeepSeek comparison pins the latest checked snapshot without enabling it in the extension', () => {
  const config = require('../evals/deepseek.config.cjs');
  const { MODELS } = require('../security.js');
  const provider = new Provider({ config: { model: 'deepseek/deepseek-v4.1-flash-1017' } });
  assert.match(provider.id(), /deepseek-v4.1-flash-1017$/);
  assert.equal(config.tests.length, cases.length);
  assert.equal(config.providers.length, 2);
  assert.ok(!MODELS.includes('deepseek/deepseek-v4.1-flash-1017'));
});

test('tulipunkt accepts contextual Finnish inflection as well as dictionary wording', () => {
  const expected = cases.find((value) => value.id === 'tulipunkt-context-regression');
  assert.equal(
    grade(
      {
        headword: 'tulipunkt',
        translation: 'kuumissa pisteissä',
        contextTranslation: 'Myös Marseillessa ja Lyonissa oli levottomuuksia.',
      },
      expected,
    ).pass,
    true,
  );
});
