import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
    filename: text('filename').notNull(),
    manifest: jsonb('manifest')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    rowCount: integer('row_count').notNull(),
    diff: jsonb('diff').$type<Record<string, unknown>>().notNull(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: catalogImportStatus('status').default('planned').notNull(),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (table) => [
    index('catalog_imports_checksum_idx').on(table.checksum),
    index('catalog_imports_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
  ],
);
