import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrationBundle } from '../src/generated-migrations.js';
import {
  runMigrations,
  type MigrationDatabase,
} from '../src/migrate.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

describePostgres('production migration executor', () => {
  let clients: readonly [Client, Client];
  let databases: readonly [MigrationDatabase, MigrationDatabase];
  let expectedDatabase: string;
  let expectedRole: string;

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error('TEST_DATABASE_URL is required.');
    }
    const url = new URL(databaseUrl);
    expectedDatabase = decodeURIComponent(url.pathname.slice(1));
    expectedRole = decodeURIComponent(url.username);
    const firstClient = new Client({ connectionString: databaseUrl });
    const secondClient = new Client({ connectionString: databaseUrl });
    await Promise.all([firstClient.connect(), secondClient.connect()]);
    clients = [firstClient, secondClient];
    databases = [databaseAdapter(firstClient), databaseAdapter(secondClient)];
  });

  afterAll(async () => {
    await Promise.all(clients.map(async (client) => client.end()));
  });

  it('serializes concurrent runs, replays the bundle, and is idempotent', async () => {
    const concurrent = await Promise.all(
      databases.map(async (database) =>
        runMigrations({
          database,
          migrations: migrationBundle,
          expectedDatabase,
          expectedRole,
        }),
      ),
    );

    if (process.env['MIGRATION_REPLAY_EXPECT_EMPTY'] === '1') {
      expect(concurrent.map(({ status }) => status).sort()).toEqual([
        'already_current',
        'applied',
      ]);
      const applied = concurrent.find(({ status }) => status === 'applied');
      expect(applied?.previousMigration).toBeNull();
      expect(applied?.applied).toEqual(
        migrationBundle.map(({ tag }) => tag),
      );
    } else {
      expect(
        concurrent.every(({ status }) => status === 'already_current'),
      ).toBe(true);
    }

    const repeated = await runMigrations({
      database: databases[0],
      migrations: migrationBundle,
      expectedDatabase,
      expectedRole,
    });
    expect(repeated).toMatchObject({
      status: 'already_current',
      applied: [],
      latestMigration: migrationBundle.at(-1)?.tag,
      latestHash: migrationBundle.at(-1)?.hash,
    });

    const journal = await clients[0].query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(journal.rows[0]?.count).toBe(String(migrationBundle.length));
  });
});

function databaseAdapter(client: Client): MigrationDatabase {
  return {
      async query(text, values) {
        const result =
          values === undefined
            ? await client.query(text)
            : await client.query(text, [...values]);
        return {
          rows: result.rows as readonly Record<string, unknown>[],
        };
      },
    };
}
