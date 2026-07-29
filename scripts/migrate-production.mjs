import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  productionMigrationConfigPath,
  setupProductionMigration,
} from './setup-production-migration.mjs';
import { runCommand } from './run-command.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function runProductionMigration(options = {}) {
  const operations = options.operations ?? createDefaultOperations();
  const createToken =
    options.createToken ?? (() => randomBytes(32).toString('hex'));
  const createSuffix =
    options.createSuffix ?? (() => randomBytes(3).toString('hex'));
  const writeLine =
    options.writeLine ?? ((value) => globalThis.console.log(value));

  await operations.assertCleanWorktree();
  await operations.runLocalChecks();
  const configuration = await operations.ensureConfiguration();
  const gitSha = await operations.getGitSha();
  const workerName = `ddl-tracker-migrate-${gitSha.slice(0, 8)}-${createSuffix()}`;
  const token = createToken();
  if (token.length < 32) {
    throw new Error('The generated migration token is too short.');
  }

  writeLine(`Temporary Worker: ${workerName}`);
  let deploymentAttempted = false;
  let primaryError;
  let result;
  try {
    deploymentAttempted = true;
    const url = await operations.deployWorker({
      name: workerName,
      token,
      gitSha,
      configuration,
    });
    result = await operations.invokeWorker({
      name: workerName,
      url,
      token,
    });
  } catch (error) {
    primaryError = error;
  }

  let cleanupError;
  if (deploymentAttempted) {
    try {
      await operations.deleteWorker({ name: workerName });
      writeLine('Temporary Worker deleted.');
    } catch (error) {
      cleanupError = error;
    }
  }

  const cleanupCommand =
    `pnpm exec wrangler delete ${workerName} --force`;
  if (cleanupError !== undefined) {
    const message =
      `Temporary Worker cleanup failed. Run: ${cleanupCommand}`;
    if (primaryError !== undefined) {
      throw new AggregateError([primaryError, cleanupError], message);
    }
    throw new Error(message, { cause: cleanupError });
  }
  if (primaryError !== undefined) throw primaryError;
  return result;
}

export function parseWorkerUrl(output) {
  const match = output.match(/https:\/\/[^\s]+\.workers\.dev\b/u);
  if (match === null) {
    throw new Error('Wrangler deploy output did not contain a workers.dev URL.');
  }
  return match[0];
}

function createDefaultOperations() {
  return {
    async ensureConfiguration() {
      return await setupProductionMigration();
    },

    async assertCleanWorktree() {
      const output = runCommand('git', [
        'status',
        '--porcelain',
        '--untracked-files=normal',
      ], { cwd: root }).stdout.trim();
      if (output.length > 0) {
        throw new Error(
          'Production migration requires a clean Git worktree and index.',
        );
      }
    },

    async runLocalChecks() {
      globalThis.console.log('Verifying generated files...');
      runCommand('pnpm', ['verify:generated'], {
        cwd: root,
        inherit: true,
      });
      globalThis.console.log(
        'Replaying migrations in temporary PostgreSQL...',
      );
      runCommand('pnpm', ['test:postgres:docker'], {
        cwd: root,
        inherit: true,
      });
      globalThis.console.log('Building the migration Worker...');
      runCommand(
        'pnpm',
        ['--filter', '@ddl-tracker/migration-worker', 'build'],
        { cwd: root, inherit: true },
      );
    },

    async getGitSha() {
      return runCommand('git', ['rev-parse', 'HEAD'], {
        cwd: root,
      }).stdout.trim();
    },

    async deployWorker({ name, token, gitSha, configuration }) {
      const directory = await mkdtemp(
        join(tmpdir(), 'ddl-tracker-migration-'),
      );
      const secretsPath = join(directory, 'secrets.json');
      try {
        await writeFile(
          secretsPath,
          `${JSON.stringify({ MIGRATION_TOKEN: token })}\n`,
          { encoding: 'utf8', mode: 0o600 },
        );
        const output = runCommand(
          'pnpm',
          [
            'exec',
            'wrangler',
            'deploy',
            '--config',
            configuration.configPath ?? productionMigrationConfigPath,
            '--name',
            name,
            '--secrets-file',
            secretsPath,
            '--message',
            `Database migration from ${gitSha}`,
            '--strict',
          ],
          { cwd: root, redact: [token] },
        );
        globalThis.console.log(output.stdout.trim());
        return parseWorkerUrl(`${output.stdout}\n${output.stderr}`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },

    async invokeWorker({ url, token }) {
      globalThis.console.log('Invoking the migration Worker...');
      return await invokeWithRetry({ url, token });
    },

    async deleteWorker({ name }) {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          runCommand(
            'pnpm',
            ['exec', 'wrangler', 'delete', name, '--force'],
            { cwd: root },
          );
          return;
        } catch (error) {
          if (isMissingWorkerError(error)) return;
          lastError = error;
          if (attempt < 2) await sleep(750 * (attempt + 1));
        }
      }
      throw lastError;
    },
  };
}

export function isMissingWorkerError(error) {
  if (!(error instanceof Error)) return false;
  return /this worker does not exist on this account|\b10090\b/iu.test(
    error.message,
  );
}

async function invokeWithRetry({ url, token }) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await globalThis.fetch(`${url}/migrate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: globalThis.AbortSignal.timeout(15 * 60 * 1000),
      });
      const text = await response.text();
      const body = parseResponseJson(text);
      if (response.ok) {
        validateSuccessResponse(body);
        return body;
      }
      if (
        [404, 502, 503, 504].includes(response.status) &&
        attempt < 11
      ) {
        await sleep(Math.min(500 * 2 ** attempt, 4000));
        continue;
      }
      const code =
        typeof body.code === 'string' ? ` ${body.code}:` : '';
      const message =
        typeof body.message === 'string' ? body.message : text;
      throw new Error(
        `Migration Worker returned ${String(response.status)}:${code} ${message}`.trim(),
      );
    } catch (error) {
      lastError = error;
      if (attempt >= 11 || !isRetryableFetchError(error)) throw error;
      await sleep(Math.min(500 * 2 ** attempt, 4000));
    }
  }
  throw lastError ?? new Error('Migration Worker request failed.');
}

function validateSuccessResponse(body) {
  if (
    (body.status !== 'applied' && body.status !== 'already_current') ||
    !Array.isArray(body.applied) ||
    typeof body.latestMigration !== 'string' ||
    typeof body.latestHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(body.latestHash)
  ) {
    throw new Error('Migration Worker returned an invalid success response.');
  }
}

function parseResponseJson(text) {
  try {
    const value = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value : {};
  } catch {
    return {};
  }
}

function isRetryableFetchError(error) {
  return (
    error instanceof TypeError ||
    (error instanceof globalThis.DOMException && error.name === 'TimeoutError')
  );
}

function sleep(milliseconds) {
  return delay(milliseconds);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  try {
    const result = await runProductionMigration();
    globalThis.console.log(`Migration status: ${result.status}`);
    globalThis.console.log(
      result.applied.length === 0
        ? 'Applied migrations: none'
        : `Applied migrations: ${result.applied.join(', ')}`,
    );
    globalThis.console.log(`Latest migration: ${result.latestMigration}`);
    globalThis.console.log(`Latest hash: ${result.latestHash}`);
  } catch (error) {
    globalThis.console.error(
      error instanceof Error ? error.message : 'Production migration failed.',
    );
    process.exitCode = 1;
  }
}
