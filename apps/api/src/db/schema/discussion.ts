import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { courseTasks } from './shared.js';

export const commentState = pgEnum('comment_state', ['visible', 'hidden']);

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => courseTasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    currentRevision: integer('current_revision').default(1).notNull(),
    state: commentState('state').default('visible').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('task_comments_task_idx').on(table.taskId),
    check(
      'task_comments_current_revision_positive',
      sql`${table.currentRevision} > 0`,
    ),
  ],
);

export const commentRevisions = pgTable(
  'comment_revisions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => taskComments.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    body: text('body').notNull(),
    authorId: uuid('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.revision] }),
    check('comment_revisions_revision_positive', sql`${table.revision} > 0`),
  ],
);
