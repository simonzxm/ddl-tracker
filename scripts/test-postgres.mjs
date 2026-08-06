import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

import { assertDisposableTestDatabaseUrl } from './test-database-url.mjs';

const root = resolve(import.meta.dirname, '..');
const configuredConnectionString = process.env.TEST_DATABASE_URL;
if (
  configuredConnectionString === undefined ||
  configuredConnectionString.length === 0
) {
  throw new Error('TEST_DATABASE_URL is required.');
}
const connectionString = assertDisposableTestDatabaseUrl(
  configuredConnectionString,
);

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('pnpm', [
  '--filter',
  '@ddl-tracker/api',
  'exec',
  'node',
  'scripts/reset-test-database.mjs',
]);
run(
  'pnpm',
  [
    'vitest',
    'run',
    'apps/migration-worker/test/postgres-migrate.test.ts',
    '--no-file-parallelism',
    '--maxWorkers',
    '1',
  ],
  {
    TEST_DATABASE_URL: connectionString,
    MIGRATION_REPLAY_EXPECT_EMPTY: '1',
  },
);
run(
  'pnpm',
  ['vitest', 'run', '--no-file-parallelism', '--maxWorkers', '1'],
  { TEST_DATABASE_URL: connectionString },
);
