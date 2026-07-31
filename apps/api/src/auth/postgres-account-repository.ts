import type { Client } from 'pg';

import type {
  AccountRepository,
  AuthenticatedPrincipal,
  PublicUser,
  SessionRecord,
} from './account-service.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  status: PublicUser['status'];
  profile_revision: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  device_name: string | null;
  device_metadata: Record<string, unknown>;
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    status: row.status,
    profileRevision: row.profile_revision,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    deviceName: row.device_name,
    deviceMetadata: row.device_metadata,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === constraint
  );
}

export class PostgresAccountRepository implements AccountRepository {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async findUserByIdentity(
    issuer: string,
    subject: string,
  ): Promise<PublicUser | null> {
    const result = await this.#client.query<UserRow>(
      `select u.id, u.username, u.display_name, u.avatar_url, u.bio,
              u.status, u.profile_revision
       from oidc_identities i
       join users u on u.id = i.user_id
       where i.issuer = $1 and i.subject = $2
       limit 1`,
      [issuer, subject],
    );
    const row = result.rows[0];
    return row === undefined ? null : toPublicUser(row);
  }

  async findRoles(userId: string): Promise<'maintainer'[]> {
    const result = await this.#client.query<{ role: 'maintainer' }>(
      `select role from user_roles where user_id = $1 order by role`,
      [userId],
    );
    return result.rows.map(({ role }) => role);
  }

  async createSession(input: SessionRecord): Promise<void> {
    await this.#insertSession(input);
  }

  async updateIdentityLogin(input: {
    issuer: string;
    subject: string;
    userId: string;
    email: string | null;
    now: Date;
  }): Promise<void> {
    await this.#client.query(
      `update oidc_identities
       set email = $4, last_login_at = $5
       where issuer = $1 and subject = $2 and user_id = $3`,
      [input.issuer, input.subject, input.userId, input.email, input.now],
    );
  }

  async createOidcAccount(
    input: Parameters<AccountRepository['createOidcAccount']>[0],
  ): Promise<'identity_exists' | 'username_taken' | 'success'> {
    await this.#client.query('begin');
    try {
      try {
        await this.#client.query(
          `insert into users (
             id, username, username_key, display_name, avatar_url, bio,
             status, profile_revision, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, null, 'active', $6, $7, $7)`,
          [
            input.user.id,
            input.user.username,
            input.user.username,
            input.user.displayName,
            input.user.avatarUrl,
            input.user.profileRevision,
            input.now,
          ],
        );
        await this.#client.query(
          `insert into oidc_identities (
             id, user_id, issuer, subject, email, created_at, last_login_at
           ) values ($1, $2, $3, $4, $5, $6, $6)`,
          [
            input.identityId,
            input.user.id,
            input.identity.issuer,
            input.identity.subject,
            input.identity.email,
            input.now,
          ],
        );
        await this.#insertSession(input.session);
        await this.#client.query('commit');
        return 'success';
      } catch (error) {
        await this.#client.query('rollback');
        if (isUniqueViolation(error, 'users_username_key_unique')) {
          return 'username_taken';
        }
        if (isUniqueViolation(error, 'oidc_identities_subject_unique')) {
          return 'identity_exists';
        }
        throw error;
      }
    } catch (error) {
      try {
        await this.#client.query('rollback');
      } catch {
        // Preserve the original database error.
      }
      throw error;
    }
  }

  async findPrincipalBySessionHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthenticatedPrincipal | null> {
    const result = await this.#client.query<SessionRow & UserRow>(
      `select s.id, s.user_id, s.token_hash, s.device_name,
              s.device_metadata, s.created_at, s.last_seen_at,
              s.idle_expires_at, s.absolute_expires_at, s.revoked_at,
              u.username, u.display_name, u.avatar_url, u.bio,
              u.status, u.profile_revision,
              u.id as user_record_id
       from sessions s
       join users u on u.id = s.user_id
       where s.token_hash = $1
         and s.revoked_at is null
         and s.idle_expires_at > $2
         and s.absolute_expires_at > $2
       limit 1`,
      [tokenHash, now],
    );
    const row = result.rows[0] as
      | ((SessionRow & Omit<UserRow, 'id'>) & { user_record_id: string })
      | undefined;
    if (row === undefined) return null;
    const roles = await this.findRoles(row.user_id);
    return {
      user: toPublicUser({
        id: row.user_record_id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        bio: row.bio,
        status: row.status,
        profile_revision: row.profile_revision,
      }),
      session: toSession(row),
      roles,
    };
  }

  async touchSession(
    sessionId: string,
    now: Date,
    idleExpiresAt: Date,
  ): Promise<void> {
    await this.#client.query(
      `update sessions
       set last_seen_at = $2, idle_expires_at = least($3, absolute_expires_at)
       where id = $1 and revoked_at is null`,
      [sessionId, now, idleExpiresAt],
    );
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    const result = await this.#client.query<SessionRow>(
      `select id, user_id, token_hash, device_name, device_metadata,
              created_at, last_seen_at, idle_expires_at,
              absolute_expires_at, revoked_at
       from sessions
       where user_id = $1
       order by created_at desc, id`,
      [userId],
    );
    return result.rows.map(toSession);
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.#client.query(
      `update sessions
       set revoked_at = $3
       where user_id = $1 and id = $2 and revoked_at is null`,
      [userId, sessionId, now],
    );
    return result.rowCount === 1;
  }

  async revokeAllSessions(userId: string, now: Date): Promise<number> {
    const result = await this.#client.query(
      `update sessions
       set revoked_at = $2
       where user_id = $1 and revoked_at is null`,
      [userId, now],
    );
    return result.rowCount ?? 0;
  }

  async #insertSession(input: SessionRecord): Promise<void> {
    await this.#client.query(
      `insert into sessions (
         id, user_id, token_hash, device_name, device_metadata,
         created_at, last_seen_at, idle_expires_at,
         absolute_expires_at, revoked_at
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [
        input.id,
        input.userId,
        input.tokenHash,
        input.deviceName,
        JSON.stringify(input.deviceMetadata),
        input.createdAt,
        input.lastSeenAt,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.revokedAt,
      ],
    );
  }
}
