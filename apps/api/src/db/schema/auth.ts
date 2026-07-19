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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userStatus = pgEnum('user_status', [
  'active',
  'suspended',
  'deleted',
]);
export const userRole = pgEnum('user_role', ['maintainer']);
export const authChallengeStatus = pgEnum('auth_challenge_status', [
  'pending',
  'active',
  'consumed',
  'expired',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    username: text('username').notNull(),
    usernameKey: text('username_key').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    status: userStatus('status').default('active').notNull(),
    profileRevision: integer('profile_revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_username_key_unique').on(table.usernameKey),
    check('users_profile_revision_positive', sql`${table.profileRevision} > 0`),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRole('role').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

export const institutionalIdentities = pgTable(
  'institutional_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    normalizedSubject: text('normalized_subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('institutional_identities_subject_unique').on(
      table.provider,
      table.normalizedSubject,
    ),
    index('institutional_identities_user_idx').on(table.userId),
  ],
);

export const authChallenges = pgTable(
  'auth_challenges',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider').notNull(),
    normalizedSubject: text('normalized_subject').notNull(),
    subjectDisplay: text('subject_display').notNull(),
    codeHmac: text('code_hmac').notNull(),
    status: authChallengeStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    sendAttemptedAt: timestamp('send_attempted_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('auth_challenges_current_subject_unique')
      .on(table.provider, table.normalizedSubject)
      .where(sql`${table.status} in ('pending', 'active')`),
    index('auth_challenges_expiry_idx').on(table.expiresAt),
    check('auth_challenges_attempts_nonnegative', sql`${table.attempts} >= 0`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    deviceName: text('device_name'),
    deviceMetadata: jsonb('device_metadata')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
    }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expiry_idx').on(table.idleExpiresAt, table.absoluteExpiresAt),
  ],
);
