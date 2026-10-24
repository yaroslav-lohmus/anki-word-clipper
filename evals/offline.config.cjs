const config = require('../promptfooconfig.cjs');
module.exports = {
  ...config,
  description: 'OFFLINE harness validation — synthetic fixtures, not a language quality evaluation',
  // Resolve paths from this config file's directory.
  prompts: ['file://prompt.cjs'],
  providers: [{ id: 'file://provider.cjs', config: { offline: true } }],
  tests: config.tests.slice(0, 3),
};
