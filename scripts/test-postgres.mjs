import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('TEST_DATABASE_URL is required.');
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('node', ['scripts/reset-test-database.mjs']);
run('pnpm', ['--filter', '@ddl-tracker/api', 'db:migrate'], {
  DATABASE_URL: connectionString,
});
run('pnpm', ['vitest', 'run'], { TEST_DATABASE_URL: connectionString });
