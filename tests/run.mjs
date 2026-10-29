import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// Prefer the project-local tsx; fall back to a globally installed one (sandbox / CI without install).
const globalTsx = '/home/claude/.npm-global/lib/node_modules/tsx/dist/loader.mjs';
const tsx = existsSync(path.join(root, 'node_modules', 'tsx')) ? 'tsx' : pathToFileURL(globalTsx).href;
const files = readdirSync(here).filter((f) => f.endsWith('.test.js')).map((f) => path.join('tests', f));
const r = spawnSync(process.execPath, ['--no-warnings', '--require', './tests/setup.cjs', '--import', tsx, '--test', ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: path.join(here, 'tsconfig.json') },
});
process.exit(r.status ?? 1);
