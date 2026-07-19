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
import { classSections } from './catalog.js';
import { courseTasks } from './shared.js';

export const personalTaskState = pgEnum('personal_task_state', [
  'pending',
  'completed',
  'ignored',
]);

export const followedClassSections = pgTable(
  'followed_class_sections',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    classSectionId: uuid('class_section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.classSectionId] })],
);

export const personalTodos = pgTable(
  'personal_todos',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    classSectionId: uuid('class_section_id').references(() => classSections.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    deadline: timestamp('deadline', { withTimezone: true }),
    note: text('note'),
    state: personalTaskState('state').default('pending').notNull(),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('personal_todos_user_idx').on(table.userId),
    index('personal_todos_class_section_idx').on(table.classSectionId),
    check('personal_todos_revision_positive', sql`${table.revision} > 0`),
  ],
);

export const personalTaskDetails = pgTable(
  'personal_task_details',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => courseTasks.id, { onDelete: 'cascade' }),
    privateTitle: text('private_title'),
    privateDeadline: timestamp('private_deadline', { withTimezone: true }),
    privateNote: text('private_note'),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    check(
      'personal_task_details_revision_positive',
      sql`${table.revision} > 0`,
    ),
  ],
);

export const personalTaskStates = pgTable(
  'personal_task_states',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => courseTasks.id, { onDelete: 'cascade' }),
    state: personalTaskState('state').notNull(),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    check(
      'personal_task_states_revision_positive',
      sql`${table.revision} > 0`,
    ),
  ],
);
