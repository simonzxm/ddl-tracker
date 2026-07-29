export interface MigrationDefinition {
  readonly tag: string;
  readonly folderMillis: number;
  readonly hash: string;
  readonly statements: readonly string[];
}

export interface MigrationDatabaseResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface MigrationDatabase {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<MigrationDatabaseResult>;
}

export type MigrationErrorCode =
  | 'database_identity_mismatch'
  | 'migration_bundle_invalid'
  | 'migration_execution_failed'
  | 'migration_history_mismatch';

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(
    code: MigrationErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'MigrationError';
    this.code = code;
  }
}

export interface MigrationRunResult {
  readonly status: 'already_current' | 'applied';
  readonly database: string;
  readonly role: string;
  readonly previousMigration: string | null;
  readonly applied: readonly string[];
  readonly latestMigration: string;
  readonly latestHash: string;
}

interface MigrationJournalRow {
  readonly hash: string;
  readonly createdAt: bigint;
}

const MIGRATION_LOCK_ID = 721_934_118;

export async function runMigrations(input: {
  database: MigrationDatabase;
  migrations: readonly MigrationDefinition[];
  expectedDatabase: string;
  expectedRole: string;
}): Promise<MigrationRunResult> {
  validateMigrationBundle(input.migrations);

  let transactionStarted = false;
  let activeMigration: MigrationDefinition | undefined;
  try {
    await input.database.query('begin');
    transactionStarted = true;
    await input.database.query("set local lock_timeout = '5s'");
    await input.database.query("set local statement_timeout = '10min'");
    await input.database.query(
      "set local application_name = 'ddl-tracker-production-migrator'",
    );
    await input.database.query(
      `select pg_advisory_xact_lock(${String(MIGRATION_LOCK_ID)}::bigint)`,
    );

    const identity = await readDatabaseIdentity(input.database);
    if (
      identity.database !== input.expectedDatabase ||
      identity.role !== input.expectedRole
    ) {
      throw new MigrationError(
        'database_identity_mismatch',
        'The migration connection targets an unexpected database or role.',
      );
    }

    await ensureMigrationJournal(input.database);
    const history = await readMigrationHistory(input.database);
    assertHistoryIsPrefix(history, input.migrations);

    const previousMigration =
      history.length === 0
        ? null
        : requireMigration(input.migrations, history.length - 1).tag;
    const pending = input.migrations.slice(history.length);

    for (const migration of pending) {
      activeMigration = migration;
      for (const statement of migration.statements) {
        if (statement.trim().length > 0) {
          await input.database.query(statement);
        }
      }
      await input.database.query(
        `insert into drizzle.__drizzle_migrations ("hash", "created_at")
         values ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
    }

    const latest = input.migrations.at(-1);
    if (latest === undefined) {
      throw new MigrationError(
        'migration_bundle_invalid',
        'The migration bundle is empty.',
      );
    }
    const latestJournalEntry = await readLatestMigration(input.database);
    if (latestJournalEntry === undefined) {
      throw new MigrationError(
        'migration_history_mismatch',
        'The migration journal did not record the expected latest migration.',
      );
    }
    if (
      latestJournalEntry.hash !== latest.hash ||
      latestJournalEntry.createdAt !== BigInt(latest.folderMillis)
    ) {
      throw new MigrationError(
        'migration_history_mismatch',
        'The migration journal did not record the expected latest migration.',
      );
    }

    await input.database.query('commit');
    transactionStarted = false;

    return {
      status: pending.length === 0 ? 'already_current' : 'applied',
      database: identity.database,
      role: identity.role,
      previousMigration,
      applied: pending.map(({ tag }) => tag),
      latestMigration: latest.tag,
      latestHash: latest.hash,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await input.database.query('rollback');
      } catch (rollbackError) {
        throw new MigrationError(
          'migration_execution_failed',
          'The migration failed and rollback could not be confirmed.',
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
    }

    if (error instanceof MigrationError) throw error;
    throw new MigrationError(
      'migration_execution_failed',
      activeMigration === undefined
        ? 'The migration transaction failed.'
        : `Migration ${activeMigration.tag} failed.`,
      { cause: error },
    );
  }
}

function validateMigrationBundle(
  migrations: readonly MigrationDefinition[],
): void {
  if (migrations.length === 0) {
    throw new MigrationError(
      'migration_bundle_invalid',
      'The migration bundle is empty.',
    );
  }

  let previousMillis = -1;
  const tags = new Set<string>();
  for (const migration of migrations) {
    if (!/^\d{4}_.+/u.test(migration.tag) || tags.has(migration.tag)) {
      throw new MigrationError(
        'migration_bundle_invalid',
        'The migration bundle contains an invalid or duplicate tag.',
      );
    }
    if (
      !Number.isSafeInteger(migration.folderMillis) ||
      migration.folderMillis <= previousMillis
    ) {
      throw new MigrationError(
        'migration_bundle_invalid',
        'Migration timestamps must be strictly increasing safe integers.',
      );
    }
    if (!/^[0-9a-f]{64}$/u.test(migration.hash)) {
      throw new MigrationError(
        'migration_bundle_invalid',
        'The migration bundle contains an invalid hash.',
      );
    }
    if (
      migration.statements.length === 0 ||
      migration.statements.every((statement) => statement.trim().length === 0)
    ) {
      throw new MigrationError(
        'migration_bundle_invalid',
        `Migration ${migration.tag} contains no SQL statements.`,
      );
    }

    tags.add(migration.tag);
    previousMillis = migration.folderMillis;
  }
}

async function readDatabaseIdentity(
  database: MigrationDatabase,
): Promise<{ database: string; role: string }> {
  const result = await database.query(
    `select current_database() as database_name,
            current_user as role_name`,
  );
  const row = result.rows[0];
  const databaseName = row?.database_name;
  const roleName = row?.role_name;
  if (typeof databaseName !== 'string' || typeof roleName !== 'string') {
    throw new MigrationError(
      'database_identity_mismatch',
      'The database identity query returned an invalid result.',
    );
  }
  return { database: databaseName, role: roleName };
}

async function ensureMigrationJournal(
  database: MigrationDatabase,
): Promise<void> {
  await database.query('create schema if not exists drizzle');
  await database.query(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
}

async function readMigrationHistory(
  database: MigrationDatabase,
): Promise<readonly MigrationJournalRow[]> {
  const result = await database.query(`
    select id, hash, created_at
    from drizzle.__drizzle_migrations
    order by created_at asc, id asc
  `);
  return result.rows.map((row, index) => parseJournalRow(row, index));
}

async function readLatestMigration(
  database: MigrationDatabase,
): Promise<MigrationJournalRow | undefined> {
  const result = await database.query(`
    select hash, created_at
    from drizzle.__drizzle_migrations
    order by created_at desc, id desc
    limit 1
  `);
  const row = result.rows[0];
  return row === undefined ? undefined : parseJournalRow(row, 0);
}

function parseJournalRow(
  row: Readonly<Record<string, unknown>>,
  index: number,
): MigrationJournalRow {
  const hash = row.hash;
  const createdAt = row.created_at;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) {
    throw new MigrationError(
      'migration_history_mismatch',
      `Migration journal row ${String(index + 1)} has an invalid hash.`,
    );
  }

  let parsedCreatedAt: bigint;
  try {
    if (
      typeof createdAt !== 'string' &&
      typeof createdAt !== 'number' &&
      typeof createdAt !== 'bigint'
    ) {
      throw new TypeError('created_at is not numeric');
    }
    parsedCreatedAt = BigInt(createdAt);
  } catch (error) {
    throw new MigrationError(
      'migration_history_mismatch',
      `Migration journal row ${String(index + 1)} has an invalid timestamp.`,
      { cause: error },
    );
  }
  return { hash, createdAt: parsedCreatedAt };
}

function assertHistoryIsPrefix(
  history: readonly MigrationJournalRow[],
  migrations: readonly MigrationDefinition[],
): void {
  if (history.length > migrations.length) {
    throw new MigrationError(
      'migration_history_mismatch',
      'The database contains migrations that are unknown to this release.',
    );
  }

  for (const [index, row] of history.entries()) {
    const expected = migrations[index];
    if (expected === undefined) {
      throw new MigrationError(
        'migration_history_mismatch',
        'The database contains migrations that are unknown to this release.',
      );
    }
    if (
      row.hash !== expected.hash ||
      row.createdAt !== BigInt(expected.folderMillis)
    ) {
      throw new MigrationError(
        'migration_history_mismatch',
        `Migration history differs at ${expected.tag}.`,
      );
    }
  }
}

function requireMigration(
  migrations: readonly MigrationDefinition[],
  index: number,
): MigrationDefinition {
  const migration = migrations[index];
  if (migration === undefined) {
    throw new MigrationError(
      'migration_history_mismatch',
      'The database contains migrations that are unknown to this release.',
    );
  }
  return migration;
}
