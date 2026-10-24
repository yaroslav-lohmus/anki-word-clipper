const base = require('../promptfooconfig.cjs');
module.exports = {
  ...base,
  description:
    'Latest pinned DeepSeek Flash vs Gemini 3.1 Flash Lite; same production request and 21 cases',
  prompts: ['file://prompt.cjs'],
  providers: [
    {
      id: 'file://provider.cjs',
      label: 'Gemini 3.1 Flash Lite',
      config: { model: 'google/gemini-3.1-flash-lite' },
    },
    {
      id: 'file://provider.cjs',
      label: 'DeepSeek V4.1 Flash 1017',
      config: { model: 'deepseek/deepseek-v4.1-flash-1017' },
    },
  ],
};
