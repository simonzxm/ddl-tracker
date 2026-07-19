import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';

export const catalogImportStatus = pgEnum('catalog_import_status', [
  'planned',
  'applied',
  'failed',
]);

export const catalogImports = pgTable(
  'catalog_imports',
  {
    id: uuid('id').primaryKey(),
    checksum: text('checksum').notNull(),
    headerHash: text('header_hash'),
    manifestHash: text('manifest_hash'),
    environment: text('environment').default('unknown').notNull(),
    filename: text('filename').notNull(),
    manifest: jsonb('manifest')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    rowCount: integer('row_count').notNull(),
    totalBatches: integer('total_batches').default(1).notNull(),
    receivedBatches: integer('received_batches').default(0).notNull(),
    appliedBatches: integer('applied_batches').default(0).notNull(),
    baselineHash: text('baseline_hash'),
    deactivationCount: integer('deactivation_count').default(0).notNull(),
    diff: jsonb('diff')
      .$type<Record<string, unknown> | null>()
      .default(null),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: catalogImportStatus('status').default('planned').notNull(),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('catalog_imports_checksum_idx').on(table.checksum),
    index('catalog_imports_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    check('catalog_imports_row_count_nonnegative', sql`${table.rowCount} >= 0`),
    check('catalog_imports_total_batches_positive', sql`${table.totalBatches} > 0`),
    check(
      'catalog_imports_batch_progress_valid',
      sql`${table.receivedBatches} >= 0 and ${table.appliedBatches} >= 0 and ${table.receivedBatches} <= ${table.totalBatches} and ${table.appliedBatches} <= ${table.totalBatches}`,
    ),
    check(
      'catalog_imports_deactivation_count_nonnegative',
      sql`${table.deactivationCount} >= 0`,
    ),
  ],
);

export const catalogImportBatches = pgTable(
  'catalog_import_batches',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => catalogImports.id, { onDelete: 'cascade' }),
    batchIndex: integer('batch_index').notNull(),
    batchChecksum: text('batch_checksum').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.batchIndex] }),
    check('catalog_import_batches_index_nonnegative', sql`${table.batchIndex} >= 0`),
  ],
);
