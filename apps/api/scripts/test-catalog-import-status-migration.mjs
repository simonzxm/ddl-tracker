import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import pg from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('TEST_DATABASE_URL is required.');
}

const migrationDirectory = resolve(import.meta.dirname, '../drizzle');
const migrationNames = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
const previousMigrations = migrationNames.filter((name) => name < '0009_');
const statusMigration = migrationNames.find((name) => name.startsWith('0009_'));
if (previousMigrations.at(-1)?.startsWith('0008_') !== true) {
  throw new Error('Expected migration 0008 as the catalog status baseline.');
}
if (statusMigration === undefined) {
  throw new Error('Catalog status migration 0009 is missing.');
}

async function applyMigration(client, name) {
  const sql = await readFile(resolve(migrationDirectory, name), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim().length > 0) {
      await client.query(statement);
    }
  }
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  for (const name of previousMigrations) {
    await applyMigration(client, name);
  }
  await client.query(
    `insert into catalog_imports (id, checksum, filename, row_count, status)
     values ('018f0000-0000-7000-8000-000000009001',
             'pre-migration', 'pre.csv', 0, 'planned')`,
  );
  const before = await client.query(
    `select enumlabel
     from pg_enum
     join pg_type on pg_type.oid = pg_enum.enumtypid
     where pg_type.typname = 'catalog_import_status'
     order by enumsortorder`,
  );
  if (before.rows.some((row) => row.enumlabel === 'cancelled')) {
    throw new Error('Pre-0009 schema unexpectedly contains terminal statuses.');
  }

  await applyMigration(client, statusMigration);
  const after = await client.query(
    `select enumlabel
     from pg_enum
     join pg_type on pg_type.oid = pg_enum.enumtypid
     where pg_type.typname = 'catalog_import_status'
     order by enumsortorder`,
  );
  const labels = after.rows.map((row) => row.enumlabel);
  if (!labels.includes('cancelled') || !labels.includes('expired')) {
    throw new Error('Migration 0009 did not add both terminal statuses.');
  }
  await client.query(
    `update catalog_imports set status = 'cancelled'
     where id = '018f0000-0000-7000-8000-000000009001'`,
  );
  const existing = await client.query(
    `select status from catalog_imports
     where id = '018f0000-0000-7000-8000-000000009001'`,
  );
  if (existing.rows[0]?.status !== 'cancelled') {
    throw new Error('Existing import did not survive the 0008 to 0009 upgrade.');
  }
} finally {
  await client.end();
}
