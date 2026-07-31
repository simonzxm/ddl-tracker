import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser, SessionRecord } from '../src/auth/account-service.js';
import type { VerifiedOidcIdentity } from '../src/auth/oidc-provider-client.js';
import { PostgresAccountRepository } from '../src/auth/postgres-account-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const NOW = new Date('2026-07-30T12:00:00.000Z');
const USER_ID = '018f0000-0000-7000-8000-000000000102';
const IDENTITY_ID = '018f0000-0000-7000-8000-000000000104';
const SESSION_ID = '018f0000-0000-7000-8000-000000000103';

const identity: VerifiedOidcIdentity = {
  issuer: 'https://issuer.example',
  subject: 'student-123',
  email: 'student@example.edu',
  displayName: 'Student',
  avatarUrl: null,
};

function publicUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: USER_ID,
    username: 'student_123',
    displayName: 'Student',
    avatarUrl: null,
    bio: null,
    status: 'active',
    profileRevision: 1,
    ...overrides,
  };
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    tokenHash: 'session-hash',
    deviceName: 'MacBook',
    deviceMetadata: { platform: 'macos' },
    createdAt: NOW,
    lastSeenAt: NOW,
    idleExpiresAt: new Date('2026-08-29T12:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-10-28T12:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

describePostgres('PostgresAccountRepository', () => {
  let client: Client;
  let repository: PostgresAccountRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresAccountRepository(client);
  });

  beforeEach(async () => {
    await client.query(
      'truncate table user_roles, sessions, oidc_identities, users cascade',
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it('atomically creates an OIDC identity, public user and local session', async () => {
    await expect(
      repository.createOidcAccount({
        now: NOW,
        user: publicUser(),
        identityId: IDENTITY_ID,
        identity,
        session: session(),
      }),
    ).resolves.toBe('success');
    await client.query(
      `insert into user_roles (user_id, role) values ($1, 'maintainer')`,
      [USER_ID],
    );

    await expect(
      repository.findUserByIdentity(identity.issuer, identity.subject),
    ).resolves.toEqual(publicUser());
    await expect(repository.findRoles(USER_ID)).resolves.toEqual(['maintainer']);
    await expect(
      repository.findPrincipalBySessionHash('session-hash', NOW),
    ).resolves.toMatchObject({
      user: publicUser(),
      session: session(),
      roles: ['maintainer'],
    });
  });

  it('returns username_taken without leaving a partial identity', async () => {
    await client.query(
      `insert into users (
         id, username, username_key, display_name, status, profile_revision
       ) values ($1, 'student_123', 'student_123', 'Existing', 'active', 1)`,
      ['018f0000-0000-7000-8000-000000000110'],
    );

    await expect(
      repository.createOidcAccount({
        now: NOW,
        user: publicUser(),
        identityId: IDENTITY_ID,
        identity,
        session: session(),
      }),
    ).resolves.toBe('username_taken');
    const counts = await client.query<{ identities: string; sessions: string }>(
      `select
         (select count(*) from oidc_identities)::text as identities,
         (select count(*) from sessions)::text as sessions`,
    );
    expect(counts.rows[0]).toEqual({ identities: '0', sessions: '0' });
  });

  it('returns identity_exists without creating a second user', async () => {
    await repository.createOidcAccount({
      now: NOW,
      user: publicUser(),
      identityId: IDENTITY_ID,
      identity,
      session: session(),
    });
    await expect(
      repository.createOidcAccount({
        now: NOW,
        user: publicUser({
          id: '018f0000-0000-7000-8000-000000000120',
          username: 'different_123',
        }),
        identityId: '018f0000-0000-7000-8000-000000000121',
        identity,
        session: session({
          id: '018f0000-0000-7000-8000-000000000122',
          userId: '018f0000-0000-7000-8000-000000000120',
          tokenHash: 'other-hash',
        }),
      }),
    ).resolves.toBe('identity_exists');
    const users = await client.query<{ count: string }>(
      'select count(*)::text as count from users',
    );
    expect(users.rows[0]?.count).toBe('1');
  });

  it('updates login metadata and supports session revocation', async () => {
    await repository.createOidcAccount({
      now: NOW,
      user: publicUser(),
      identityId: IDENTITY_ID,
      identity,
      session: session(),
    });
    const later = new Date('2026-07-31T12:00:00.000Z');
    await repository.updateIdentityLogin({
      issuer: identity.issuer,
      subject: identity.subject,
      userId: USER_ID,
      email: 'updated@example.edu',
      now: later,
    });
    const row = await client.query<{ email: string; last_login_at: Date }>(
      'select email, last_login_at from oidc_identities where user_id = $1',
      [USER_ID],
    );
    expect(row.rows[0]).toEqual({
      email: 'updated@example.edu',
      last_login_at: later,
    });

    await expect(repository.listSessions(USER_ID)).resolves.toHaveLength(1);
    await expect(repository.revokeSession(USER_ID, SESSION_ID, later)).resolves.toBe(
      true,
    );
    await expect(
      repository.findPrincipalBySessionHash('session-hash', later),
    ).resolves.toBeNull();
  });
});
