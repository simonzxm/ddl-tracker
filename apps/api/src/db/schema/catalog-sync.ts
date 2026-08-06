import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const catalogSyncRuns = pgTable(
  'catalog_sync_runs',
  {
    id: uuid('id').primaryKey(),
    repository: text('repository').notNull(),
    commitSha: text('commit_sha').notNull(),
    termCode: text('term_code').notNull(),
    sourcePath: text('source_path').notNull(),
    blobSha: text('blob_sha').notNull(),
    sourceChecksum: text('source_checksum'),
    rowCount: integer('row_count'),
    courseCount: integer('course_count'),
    classSectionCount: integer('class_section_count'),
    changed: boolean('changed'),
    diff: jsonb('diff').$type<Record<string, unknown> | null>().default(null),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('catalog_sync_runs_term_completed_idx').on(
      table.repository,
      table.termCode,
      table.completedAt,
    ),
    index('catalog_sync_runs_status_completed_idx').on(
      table.status,
      table.completedAt,
    ),
    check(
      'catalog_sync_runs_status_valid',
      sql`${table.status} in ('succeeded', 'failed')`,
    ),
    check(
      'catalog_sync_runs_counts_nonnegative',
      sql`(${table.rowCount} is null or ${table.rowCount} >= 0)
        and (${table.courseCount} is null or ${table.courseCount} >= 0)
        and (${table.classSectionCount} is null or ${table.classSectionCount} >= 0)`,
    ),
    check(
      'catalog_sync_runs_time_order',
      sql`${table.startedAt} <= ${table.completedAt}`,
    ),
  ],
);

export const catalogSyncState = pgTable(
  'catalog_sync_state',
  {
    repository: text('repository').notNull(),
    termCode: text('term_code').notNull(),
    commitSha: text('commit_sha').notNull(),
    blobSha: text('blob_sha').notNull(),
    sourceChecksum: text('source_checksum').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => catalogSyncRuns.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.repository, table.termCode] }),
    index('catalog_sync_state_synced_idx').on(table.syncedAt),
  ],
);
