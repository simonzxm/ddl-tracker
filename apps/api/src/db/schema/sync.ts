import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { classSections } from './catalog.js';

export const operationReceiptStatus = pgEnum('operation_receipt_status', [
  'applied',
  'rejected',
  'dependency_failed',
]);
export const syncEventScope = pgEnum('sync_event_scope', [
  'private_user',
  'class_section_public',
  'authenticated_global',
  'maintainer_private',
]);

export const operationReceipts = pgTable(
  'operation_receipts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operationId: uuid('operation_id').notNull(),
    requestDigest: text('request_digest').notNull(),
    status: operationReceiptStatus('status').notNull(),
    stableResult: jsonb('stable_result')
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.operationId] }),
    index('operation_receipts_expiry_idx').on(table.expiresAt),
  ],
);

export const syncEventRetention = pgTable(
  'sync_event_retention',
  {
    singletonId: integer('singleton_id').primaryKey().default(1),
    minimumSequence: bigint('minimum_sequence', { mode: 'number' })
      .default(0)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check('sync_event_retention_singleton', sql`${table.singletonId} = 1`),
    check(
      'sync_event_retention_sequence_nonnegative',
      sql`${table.minimumSequence} >= 0`,
    ),
  ],
);

export const syncEvents = pgTable(
  'sync_events',
  {
    sequence: bigserial('sequence', { mode: 'bigint' }).primaryKey(),
    eventId: uuid('event_id').notNull(),
    scope: syncEventScope('scope').notNull(),
    scopeUserId: uuid('scope_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    classSectionId: uuid('class_section_id').references(() => classSections.id, {
      onDelete: 'cascade',
    }),
    type: text('type').notNull(),
    schemaVersion: integer('schema_version').default(1).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('sync_events_event_id_unique').on(table.eventId),
    index('sync_events_scope_sequence_idx').on(table.scope, table.sequence),
    index('sync_events_user_sequence_idx').on(table.scopeUserId, table.sequence),
    index('sync_events_class_sequence_idx').on(
      table.classSectionId,
      table.sequence,
    ),
    check('sync_events_schema_version_positive', sql`${table.schemaVersion} > 0`),
    check(
      'sync_events_scope_target_valid',
      sql`(
        (${table.scope} = 'private_user' and ${table.scopeUserId} is not null and ${table.classSectionId} is null)
        or (${table.scope} = 'class_section_public' and ${table.scopeUserId} is null and ${table.classSectionId} is not null)
        or (${table.scope} in ('authenticated_global', 'maintainer_private') and ${table.scopeUserId} is null and ${table.classSectionId} is null)
      )`,
    ),
  ],
);
