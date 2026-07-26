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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { classSections } from './catalog.js';

export const courseTaskState = pgEnum('course_task_state', [
  'visible',
  'hidden',
  'merged',
]);
export const proposalState = pgEnum('proposal_state', [
  'visible',
  'hidden',
  'redirected',
]);
export const voteDirection = pgEnum('vote_direction', ['up', 'down', 'none']);

export const courseTasks = pgTable(
  'course_tasks',
  {
    id: uuid('id').primaryKey(),
    classSectionId: uuid('class_section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    state: courseTaskState('state').default('visible').notNull(),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('course_tasks_class_section_idx').on(table.classSectionId),
    check('course_tasks_revision_positive', sql`${table.revision} > 0`),
  ],
);

export const taskProposals = pgTable(
  'task_proposals',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => courseTasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    deadline: timestamp('deadline', { withTimezone: true }).notNull(),
    description: text('description'),
    evidenceNote: text('evidence_note'),
    evidenceUrl: text('evidence_url'),
    contentFingerprint: text('content_fingerprint').notNull(),
    state: proposalState('state').default('visible').notNull(),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('task_proposals_task_fingerprint_unique').on(
      table.taskId,
      table.contentFingerprint,
    ),
    index('task_proposals_task_idx').on(table.taskId),
    check('task_proposals_revision_positive', sql`${table.revision} > 0`),
  ],
);

export const accuracyVotes = pgTable(
  'accuracy_votes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => taskProposals.id, { onDelete: 'cascade' }),
    direction: voteDirection('direction').notNull(),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.proposalId] }),
    check('accuracy_votes_revision_positive', sql`${table.revision} > 0`),
  ],
);

export const proposalVoteTotals = pgTable(
  'proposal_vote_totals',
  {
    proposalId: uuid('proposal_id')
      .primaryKey()
      .references(() => taskProposals.id, { onDelete: 'cascade' }),
    up: integer('up').default(0).notNull(),
    down: integer('down').default(0).notNull(),
    revision: integer('revision').default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check('proposal_vote_totals_up_nonnegative', sql`${table.up} >= 0`),
    check('proposal_vote_totals_down_nonnegative', sql`${table.down} >= 0`),
    check(
      'proposal_vote_totals_revision_positive',
      sql`${table.revision} > 0`,
    ),
  ],
);

export const proposalRedirects = pgTable(
  'proposal_redirects',
  {
    sourceProposalId: uuid('source_proposal_id')
      .primaryKey()
      .references(() => taskProposals.id, { onDelete: 'cascade' }),
    canonicalProposalId: uuid('canonical_proposal_id')
      .notNull()
      .references(() => taskProposals.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('proposal_redirects_canonical_idx').on(table.canonicalProposalId),
    check(
      'proposal_redirects_not_self',
      sql`${table.sourceProposalId} <> ${table.canonicalProposalId}`,
    ),
  ],
);
