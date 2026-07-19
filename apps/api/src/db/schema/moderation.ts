import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { courseTasks } from './shared.js';

export const reportStatus = pgEnum('report_status', [
  'open',
  'resolved',
  'dismissed',
]);
export const reportTargetType = pgEnum('report_target_type', [
  'course_task',
  'proposal',
  'comment',
  'user',
]);
export const reportReason = pgEnum('report_reason', [
  'inaccurate',
  'spam',
  'abuse',
  'privacy',
  'other',
]);
export const moderationActionType = pgEnum('moderation_action_type', [
  'hide',
  'restore',
  'suspend',
  'unsuspend',
]);

export const contentReports = pgTable(
  'content_reports',
  {
    id: uuid('id').primaryKey(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: reportTargetType('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: reportReason('reason').notNull(),
    details: text('details'),
    status: reportStatus('status').default('open').notNull(),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('content_reports_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    index('content_reports_target_idx').on(table.targetType, table.targetId),
  ],
);

export const taskMerges = pgTable(
  'task_merges',
  {
    sourceTaskId: uuid('source_task_id')
      .primaryKey()
      .references(() => courseTasks.id, { onDelete: 'restrict' }),
    targetTaskId: uuid('target_task_id')
      .notNull()
      .references(() => courseTasks.id, { onDelete: 'restrict' }),
    maintainerId: uuid('maintainer_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('task_merges_target_idx').on(table.targetTaskId),
    check(
      'task_merges_not_self',
      sql`${table.sourceTaskId} <> ${table.targetTaskId}`,
    ),
  ],
);

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: moderationActionType('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('moderation_actions_target_idx').on(table.targetType, table.targetId),
    index('moderation_actions_actor_idx').on(table.actorId, table.createdAt),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    reason: text('reason'),
    result: jsonb('result')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('audit_log_created_idx').on(table.createdAt),
    index('audit_log_actor_idx').on(table.actorId, table.createdAt),
  ],
);
