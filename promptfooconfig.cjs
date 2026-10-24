const cases = require('./evals/cases.cjs');
const { grade } = require('./evals/assertions.cjs');
module.exports = {
  description: 'Estonian–Finnish ERR vocabulary: production prompt, request builder and parser',
  prompts: ['file://evals/prompt.cjs'],
  providers: [
    {
      id: 'file://evals/provider.cjs',
      label: 'Gemini 3.1 Flash Lite',
      config: { model: 'google/gemini-3.1-flash-lite' },
    },
    {
      id: 'file://evals/provider.cjs',
      label: 'Gemini 2.5 Flash Lite',
      config: { model: 'google/gemini-2.5-flash-lite' },
    },
  ],
  evaluateOptions: { maxConcurrency: 1 },
  tests: cases.map(({ id, word, context, wide = '', ...expectations }) => ({
    description: id,
    vars: { word, context, wide },
    assert: [
      { type: 'javascript', value: (output) => grade(output, { ...expectations, context }) },
    ],
  })),
};
