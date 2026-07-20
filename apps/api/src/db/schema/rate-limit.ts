import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    scope: text('scope').notNull(),
    subjectKey: text('subject_key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').default(1).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.scope, table.subjectKey, table.windowStart],
    }),
    index('rate_limit_counters_expiry_idx').on(table.expiresAt),
    check('rate_limit_counters_count_positive', sql`${table.count} > 0`),
    check(
      'rate_limit_counters_window_valid',
      sql`${table.expiresAt} > ${table.windowStart}`,
    ),
  ],
);
