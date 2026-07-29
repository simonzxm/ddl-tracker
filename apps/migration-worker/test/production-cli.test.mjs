import { describe, expect, it, vi } from 'vitest';

import {
  isMissingWorkerError,
  parseWorkerUrl,
  runProductionMigration,
} from '../../../scripts/migrate-production.mjs';
import { createChildEnvironment } from '../../../scripts/run-command.mjs';

function operations(overrides = {}) {
  const calls = [];
  const value = {
    ensureConfiguration: vi.fn(async () => {
      calls.push('configure');
      return { configPath: '/repo/wrangler.production.jsonc' };
    }),
    assertCleanWorktree: vi.fn(async () => {
      calls.push('clean');
    }),
    runLocalChecks: vi.fn(async () => {
      calls.push('checks');
    }),
    getGitSha: vi.fn(async () => {
      calls.push('sha');
      return '0123456789abcdef';
    }),
    deployWorker: vi.fn(async ({ name, token }) => {
      calls.push(`deploy:${name}:${token}`);
      return `https://${name}.example.workers.dev`;
    }),
    invokeWorker: vi.fn(async ({ name }) => {
      calls.push(`invoke:${name}`);
      return {
        status: 'applied',
        applied: ['0011_hot_red_skull'],
        latestMigration: '0011_hot_red_skull',
        latestHash: 'a'.repeat(64),
      };
    }),
    deleteWorker: vi.fn(async ({ name }) => {
      calls.push(`delete:${name}`);
    }),
    ...overrides,
  };
  return { calls, operations: value };
}

describe('runProductionMigration', () => {
  it('performs local checks before deploying and always deletes after success', async () => {
    const fixture = operations();

    const result = await runProductionMigration({
      operations: fixture.operations,
      createToken: () => 't'.repeat(64),
      createSuffix: () => 'cafe',
      writeLine: vi.fn(),
    });

    expect(result.status).toBe('applied');
    expect(fixture.calls).toEqual([
      'clean',
      'checks',
      'configure',
      'sha',
      `deploy:ddl-tracker-migrate-01234567-cafe:${'t'.repeat(64)}`,
      'invoke:ddl-tracker-migrate-01234567-cafe',
      'delete:ddl-tracker-migrate-01234567-cafe',
    ]);
  });

  it('deletes the temporary Worker when invocation fails', async () => {
    const fixture = operations({
      invokeWorker: vi.fn(async ({ name }) => {
        fixture.calls.push(`invoke:${name}`);
        throw new Error('migration request failed');
      }),
    });

    await expect(
      runProductionMigration({
        operations: fixture.operations,
        createToken: () => 't'.repeat(64),
        createSuffix: () => 'cafe',
        writeLine: vi.fn(),
      }),
    ).rejects.toThrow('migration request failed');
    expect(fixture.operations.deleteWorker).toHaveBeenCalledOnce();
  });

  it('attempts deletion even when deployment fails before returning a URL', async () => {
    const fixture = operations({
      deployWorker: vi.fn(async ({ name }) => {
        fixture.calls.push(`deploy:${name}`);
        throw new Error('deploy output was lost');
      }),
    });

    await expect(
      runProductionMigration({
        operations: fixture.operations,
        createToken: () => 't'.repeat(64),
        createSuffix: () => 'cafe',
        writeLine: vi.fn(),
      }),
    ).rejects.toThrow('deploy output was lost');
    expect(fixture.operations.deleteWorker).toHaveBeenCalledOnce();
  });

  it('reports the exact manual cleanup command when deletion fails', async () => {
    const fixture = operations({
      deleteWorker: vi.fn(async () => {
        throw new Error('Cloudflare cleanup failed');
      }),
    });

    await expect(
      runProductionMigration({
        operations: fixture.operations,
        createToken: () => 't'.repeat(64),
        createSuffix: () => 'cafe',
        writeLine: vi.fn(),
      }),
    ).rejects.toThrow(
      'pnpm exec wrangler delete ddl-tracker-migrate-01234567-cafe --force',
    );
  });
});

describe('parseWorkerUrl', () => {
  it('extracts the workers.dev trigger from Wrangler output', () => {
    expect(
      parseWorkerUrl(`\nUploaded worker\n  https://temporary.example.workers.dev\n`),
    ).toBe('https://temporary.example.workers.dev');
  });

  it('rejects deploy output without a workers.dev trigger', () => {
    expect(() => parseWorkerUrl('Uploaded worker without a trigger')).toThrow(
      'workers.dev URL',
    );
  });
});

describe('isMissingWorkerError', () => {
  it.each([
    'This Worker does not exist on this account.',
    'Cloudflare API error code: 10090',
  ])('recognizes an already absent Worker: %s', (message) => {
    expect(isMissingWorkerError(new Error(message))).toBe(true);
  });

  it('does not hide unrelated deletion failures', () => {
    expect(isMissingWorkerError(new Error('permission denied'))).toBe(false);
  });
});

describe('createChildEnvironment', () => {
  it('removes the setup password before spawning any child process', () => {
    expect(
      createChildEnvironment({
        KEEP_ME: 'value',
        DDL_TRACKER_MIGRATION_DATABASE_PASSWORD: 'secret',
      }),
    ).toEqual({ KEEP_ME: 'value', NO_COLOR: '1' });
  });
});
