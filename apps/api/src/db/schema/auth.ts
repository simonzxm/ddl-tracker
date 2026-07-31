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
export const oidcLoginStatus = pgEnum('oidc_login_status', [
  'pending',
  'exchanging',
  'completed',
  'consumed',
  'failed',
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

export const oidcIdentities = pgTable(
  'oidc_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('oidc_identities_subject_unique').on(
      table.issuer,
      table.subject,
    ),
    index('oidc_identities_user_idx').on(table.userId),
  ],
);

export const oidcLoginTransactions = pgTable(
  'oidc_login_transactions',
  {
    id: uuid('id').primaryKey(),
    stateHash: text('state_hash').notNull(),
    secretsCiphertext: text('secrets_ciphertext'),
    redirectUri: text('redirect_uri').notNull(),
    status: oidcLoginStatus('status').default('pending').notNull(),
    issuer: text('issuer'),
    subject: text('subject'),
    email: text('email'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    exchangeCodeHash: text('exchange_code_hash'),
    errorCode: text('error_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('oidc_login_transactions_state_hash_unique').on(table.stateHash),
    uniqueIndex('oidc_login_transactions_exchange_code_unique')
      .on(table.exchangeCodeHash)
      .where(sql`${table.exchangeCodeHash} is not null`),
    index('oidc_login_transactions_expiry_idx').on(table.expiresAt),
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
