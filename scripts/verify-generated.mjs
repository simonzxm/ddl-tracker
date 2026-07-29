import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const api = resolve(root, 'apps/api');
const actualVars = resolve(api, '.dev.vars');
const exampleVars = resolve(api, '.dev.vars.example');
const createdVars = !existsSync(actualVars);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  if (createdVars) copyFileSync(exampleVars, actualVars);
  run('pnpm', ['exec', 'wrangler', 'types', '--env-interface', 'Env', '--strict-vars', 'false'], api);
} finally {
  if (createdVars) rmSync(actualVars, { force: true });
}

run('git', ['diff', '--exit-code', '--', 'apps/api/worker-configuration.d.ts']);
run('pnpm', [
  '--filter',
  '@ddl-tracker/migration-worker',
  'types:worker',
]);
run('git', [
  'diff',
  '--exit-code',
  '--',
  'apps/migration-worker/worker-configuration.d.ts',
]);
run('pnpm', ['--filter', '@ddl-tracker/api', 'db:generate']);
run('git', [
  'diff',
  '--exit-code',
  '--',
  'apps/api/drizzle',
  'apps/api/src/db/latest-migration.ts',
  'apps/migration-worker/src/generated-migrations.ts',
]);
