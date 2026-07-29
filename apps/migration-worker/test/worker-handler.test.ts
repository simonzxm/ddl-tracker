import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { MigrationError } from '../src/migrate.js';
import {
  createMigrationWorker,
  type MigrationWorkerEnvironment,
} from '../src/worker-handler.js';

const token = 'a'.repeat(64);

function environment(
  overrides: Partial<MigrationWorkerEnvironment> = {},
): MigrationWorkerEnvironment {
  return {
    MIGRATION_DATABASE: {
      connectionString: 'postgresql://hyperdrive.invalid/ddl_tracker',
    },
    MIGRATION_TOKEN: token,
    EXPECTED_DATABASE: 'ddl_tracker',
    EXPECTED_ROLE: 'ddl_tracker_migration',
    ...overrides,
  };
}

function client(): Client {
  return {
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Client;
}

const migrationResult = {
  status: 'applied' as const,
  database: 'ddl_tracker',
  role: 'ddl_tracker_migration',
  previousMigration: '0000_initial',
  applied: ['0001_add_name'],
  latestMigration: '0001_add_name',
  latestHash: 'b'.repeat(64),
};

describe('createMigrationWorker', () => {
  it('hides the endpoint unless the exact bearer token is supplied', async () => {
    const createClient = vi.fn(() => client());
    const executeMigrations = vi.fn(async () => migrationResult);
    const worker = createMigrationWorker({
      createClient,
      executeMigrations,
      migrations: [],
    });

    const responses = await Promise.all([
      worker.fetch(
        new Request('https://migration.example/migrate', { method: 'GET' }),
        environment(),
      ),
      worker.fetch(
        new Request('https://migration.example/migrate', {
          method: 'POST',
          headers: { authorization: `Bearer ${'b'.repeat(64)}` },
        }),
        environment(),
      ),
      worker.fetch(
        new Request('https://migration.example/other', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
        environment(),
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404]);
    expect(createClient).not.toHaveBeenCalled();
    expect(executeMigrations).not.toHaveBeenCalled();
  });

  it('connects once, runs the bundled migrations, and closes the client', async () => {
    const databaseClient = client();
    const executeMigrations = vi.fn(async () => migrationResult);
    const worker = createMigrationWorker({
      createClient: () => databaseClient,
      executeMigrations,
      migrations: [],
    });

    const response = await worker.fetch(
      new Request('https://migration.example/migrate', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      environment(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(migrationResult);
    expect(databaseClient.connect).toHaveBeenCalledOnce();
    expect(executeMigrations).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDatabase: 'ddl_tracker',
        expectedRole: 'ddl_tracker_migration',
      }),
    );
    expect(databaseClient.end).toHaveBeenCalledOnce();
  });

  it('returns a safe conflict for migration history drift', async () => {
    const databaseClient = client();
    const worker = createMigrationWorker({
      createClient: () => databaseClient,
      executeMigrations: vi.fn(async () => {
        throw new MigrationError(
          'migration_history_mismatch',
          'Migration history differs at 0001_add_name.',
        );
      }),
      migrations: [],
    });

    const response = await worker.fetch(
      new Request('https://migration.example/migrate', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      environment(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      status: 'failed',
      code: 'migration_history_mismatch',
      message: 'Migration history differs at 0001_add_name.',
    });
    expect(databaseClient.end).toHaveBeenCalledOnce();
  });

  it('does not expose unexpected database errors', async () => {
    const worker = createMigrationWorker({
      createClient: () => client(),
      executeMigrations: vi.fn(async () => {
        throw new Error('password and raw SQL must stay private');
      }),
      migrations: [],
    });

    const response = await worker.fetch(
      new Request('https://migration.example/migrate', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      environment(),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('migration_execution_failed');
    expect(body).not.toContain('password');
    expect(body).not.toContain('raw SQL');
  });

  it('turns client construction failures into a safe unavailable response', async () => {
    const worker = createMigrationWorker({
      createClient: () => {
        throw new Error('connection string contains a secret');
      },
      executeMigrations: vi.fn(async () => migrationResult),
      migrations: [],
    });

    const response = await worker.fetch(
      new Request('https://migration.example/migrate', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      environment(),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain('database_unavailable');
    expect(body).not.toContain('connection string');
    expect(body).not.toContain('secret');
  });
});
