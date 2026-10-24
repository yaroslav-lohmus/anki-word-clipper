const { buildAiRequest } = require('../translator.js');
module.exports = ({ vars }) =>
  buildAiRequest({
    apiKey: '',
    model: 'selected-by-provider',
    word: vars.word,
    context: vars.context ?? '',
    wide: vars.wide ?? '',
    avoid: vars.avoid ?? '',
  }).options.body;
