import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dotenv = join(root, '.env');
if (existsSync(dotenv)) process.loadEnvFile(dotenv);
const offline = process.argv.includes('--offline');
const view = process.argv.includes('--view');
const deepseek = process.argv.includes('--deepseek');
if (!offline && !view && !process.env.OPENROUTER_API_KEY?.trim()) {
  console.error(
    'No OpenRouter key configured. Add OPENROUTER_API_KEY to .env (see .env.example). Nothing was sent. Use pnpm eval:offline for a free harness check.',
  );
  process.exit(1);
}
const configDir = join(root, 'output', 'promptfoo');
mkdirSync(configDir, { recursive: true });
const report = `output/eval-${offline ? 'offline' : deepseek ? 'deepseek' : 'live'}.json`;
const args = view
  ? ['view']
  : [
      'eval',
      '-c',
      offline
        ? 'evals/offline.config.cjs'
        : deepseek
          ? 'evals/deepseek.config.cjs'
          : 'promptfooconfig.cjs',
      '--no-cache',
      '-o',
      report,
      ...process.argv.slice(2).filter((value) => !['--offline', '--deepseek'].includes(value)),
    ];
const result = spawnSync(
  process.execPath,
  [join(root, 'node_modules/promptfoo/dist/src/main.js'), ...args],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PROMPTFOO_DISABLE_TELEMETRY: '1',
      PROMPTFOO_DISABLE_UPDATE: '1',
      PROMPTFOO_CONFIG_DIR: configDir,
    },
  },
);
if (result.error) console.error('Could not start Promptfoo. Run pnpm install --frozen-lockfile.');
process.exit(result.status ?? 1);
