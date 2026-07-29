import { describe, expect, it } from 'vitest';

import {
  runMigrations,
  type MigrationDatabase,
  type MigrationDefinition,
} from '../src/migrate.js';

const migrations: readonly MigrationDefinition[] = [
  {
    tag: '0000_initial',
    folderMillis: 1_700_000_000_000,
    hash: 'a'.repeat(64),
    statements: ['create table example (id integer primary key);'],
  },
  {
    tag: '0001_add_name',
    folderMillis: 1_700_000_001_000,
    hash: 'b'.repeat(64),
    statements: ['alter table example add column name text;'],
  },
];

interface QueryCall {
  text: string;
  values: readonly unknown[] | undefined;
}

function normalized(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

function database(options: {
  history?: readonly Record<string, unknown>[];
  identity?: { database_name: string; role_name: string };
  failOn?: string;
} = {}): { database: MigrationDatabase; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  let history = [...(options.history ?? [])];

  return {
    calls,
    database: {
      async query(text, values) {
        calls.push({ text, values });
        const sql = normalized(text);

        if (options.failOn !== undefined && sql.includes(options.failOn)) {
          throw new Error('database failure');
        }
        if (sql.includes('current_database()')) {
          return {
            rows: [
              options.identity ?? {
                database_name: 'ddl_tracker',
                role_name: 'ddl_tracker_migration',
              },
            ],
          };
        }
        if (
          sql.startsWith('select id, hash, created_at') &&
          sql.includes('order by created_at asc')
        ) {
          return { rows: history };
        }
        if (sql.startsWith('insert into drizzle.__drizzle_migrations')) {
          history = [
            ...history,
            {
              id: history.length + 1,
              hash: values?.[0],
              created_at: values?.[1],
            },
          ];
        }
        if (
          sql.startsWith('select hash, created_at') &&
          sql.includes('order by created_at desc')
        ) {
          const latest = history.at(-1);
          return { rows: latest === undefined ? [] : [latest] };
        }
        return { rows: [] };
      },
    },
  };
}

describe('runMigrations', () => {
  it('applies the pending suffix and records it in the Drizzle journal', async () => {
    const initialHistory = [
      {
        id: 1,
        hash: 'a'.repeat(64),
        created_at: '1700000000000',
      },
    ];
    const fixture = database({ history: initialHistory });

    const result = await runMigrations({
      database: fixture.database,
      migrations,
      expectedDatabase: 'ddl_tracker',
      expectedRole: 'ddl_tracker_migration',
    });

    expect(result).toEqual({
      status: 'applied',
      database: 'ddl_tracker',
      role: 'ddl_tracker_migration',
      previousMigration: '0000_initial',
      applied: ['0001_add_name'],
      latestMigration: '0001_add_name',
      latestHash: 'b'.repeat(64),
    });
    expect(fixture.calls.map(({ text }) => normalized(text))).toContain(
      'alter table example add column name text;',
    );
    expect(fixture.calls).toContainEqual({
      text: expect.stringContaining(
        'insert into drizzle.__drizzle_migrations',
      ),
      values: ['b'.repeat(64), 1_700_000_001_000],
    });
    expect(normalized(lastCall(fixture.calls).text)).toBe('commit');
  });

  it('refuses a database journal that is not an exact bundle prefix', async () => {
    const fixture = database({
      history: [
        {
          id: 1,
          hash: 'f'.repeat(64),
          created_at: '1700000000000',
        },
      ],
    });

    await expect(
      runMigrations({
        database: fixture.database,
        migrations,
        expectedDatabase: 'ddl_tracker',
        expectedRole: 'ddl_tracker_migration',
      }),
    ).rejects.toMatchObject({
      code: 'migration_history_mismatch',
    });
    expect(fixture.calls.map(({ text }) => normalized(text))).not.toContain(
      'create table example (id integer primary key);',
    );
    expect(normalized(lastCall(fixture.calls).text)).toBe('rollback');
  });

  it('refuses to migrate the wrong database or role', async () => {
    const fixture = database({
      identity: {
        database_name: 'postgres',
        role_name: 'ddl_tracker_runtime',
      },
    });

    await expect(
      runMigrations({
        database: fixture.database,
        migrations,
        expectedDatabase: 'ddl_tracker',
        expectedRole: 'ddl_tracker_migration',
      }),
    ).rejects.toMatchObject({
      code: 'database_identity_mismatch',
    });
    expect(normalized(lastCall(fixture.calls).text)).toBe('rollback');
  });

  it('rolls back the complete pending batch when a statement fails', async () => {
    const fixture = database({ failOn: 'alter table example' });

    await expect(
      runMigrations({
        database: fixture.database,
        migrations,
        expectedDatabase: 'ddl_tracker',
        expectedRole: 'ddl_tracker_migration',
      }),
    ).rejects.toMatchObject({
      code: 'migration_execution_failed',
    });
    expect(normalized(lastCall(fixture.calls).text)).toBe('rollback');
  });
});

function lastCall(calls: readonly QueryCall[]): QueryCall {
  const call = calls.at(-1);
  if (call === undefined) throw new Error('Expected at least one query call.');
  return call;
}
