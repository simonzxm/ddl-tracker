import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  PublicUser,
  RegistrationIdentity,
  SessionRecord,
} from '../src/auth/account-service.js';
import { PostgresAccountRepository } from '../src/auth/postgres-account-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const NOW = new Date('2026-07-19T12:00:00.000Z');

function registration(overrides?: Partial<RegistrationIdentity>): RegistrationIdentity {
  return {
    id: '018f0000-0000-7000-8000-000000000101',
    tokenHash: 'registration-hash',
    provider: 'email',
    normalizedSubject: 'student@example.edu',
    subjectDisplay: 'student@example.edu',
    attempts: 0,
    expiresAt: new Date(NOW.getTime() + 60_000),
    createdAt: NOW,
    ...overrides,
  };
}

function publicUser(overrides?: Partial<PublicUser>): PublicUser {
  return {
    id: '018f0000-0000-7000-8000-000000000102',
    username: 'student',
    displayName: 'Student',
    status: 'active',
    profileRevision: 1,
    ...overrides,
  };
}

function session(overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: '018f0000-0000-7000-8000-000000000103',
    userId: '018f0000-0000-7000-8000-000000000102',
    tokenHash: 'session-hash',
    deviceName: 'MacBook',
    deviceMetadata: { platform: 'macOS' },
    createdAt: NOW,
    lastSeenAt: NOW,
    idleExpiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    absoluteExpiresAt: new Date(NOW.getTime() + 180 * 24 * 60 * 60 * 1000),
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
      'truncate table user_roles, sessions, institutional_identities, registration_tokens, users cascade',
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it('atomically consumes a registration token and creates account identity and session', async () => {
    await repository.saveRegistrationIdentity(registration());

    await expect(
      repository.registerAccount({
        registrationTokenHash: 'registration-hash',
        now: NOW,
        user: publicUser(),
        identityId: '018f0000-0000-7000-8000-000000000104',
        session: session(),
      }),
    ).resolves.toBe('success');

    await expect(
      repository.findUserByIdentity('email', 'student@example.edu'),
    ).resolves.toEqual(publicUser());
    await expect(
      repository.findPrincipalBySessionHash('session-hash', NOW),
    ).resolves.toMatchObject({
      user: publicUser(),
      session: session(),
      roles: [],
    });

    await expect(
      repository.registerAccount({
        registrationTokenHash: 'registration-hash',
        now: NOW,
        user: publicUser({
          id: '018f0000-0000-7000-8000-000000000105',
          username: 'other',
        }),
        identityId: '018f0000-0000-7000-8000-000000000106',
        session: session({
          id: '018f0000-0000-7000-8000-000000000107',
          userId: '018f0000-0000-7000-8000-000000000105',
          tokenHash: 'other-session-hash',
        }),
      }),
    ).resolves.toBe('invalid');
  });

  it('returns username_taken without consuming the registration token', async () => {
    await client.query(
      `insert into users (
        id, username, username_key, display_name, status, profile_revision
      ) values ($1, 'student', 'student', 'Existing', 'active', 1)`,
      ['018f0000-0000-7000-8000-000000000110'],
    );
    await repository.saveRegistrationIdentity(registration());

    await expect(
      repository.registerAccount({
        registrationTokenHash: 'registration-hash',
        now: NOW,
        user: publicUser(),
        identityId: '018f0000-0000-7000-8000-000000000111',
        session: session(),
      }),
    ).resolves.toBe('username_taken');

    const token = await client.query<{
      consumed_at: Date | null;
      attempts: number;
    }>(
      `select consumed_at, attempts
       from registration_tokens where token_hash = $1`,
      ['registration-hash'],
    );
    expect(token.rows[0]).toEqual({ consumed_at: null, attempts: 1 });
  });

  it('uses fresh session and account state and supports revocation', async () => {
    await repository.saveRegistrationIdentity(registration());
    await repository.registerAccount({
      registrationTokenHash: 'registration-hash',
      now: NOW,
      user: publicUser(),
      identityId: '018f0000-0000-7000-8000-000000000112',
      session: session(),
    });

    await expect(repository.listSessions(publicUser().id)).resolves.toHaveLength(1);
    await expect(
      repository.revokeSession(publicUser().id, session().id, NOW),
    ).resolves.toBe(true);
    await expect(
      repository.findPrincipalBySessionHash('session-hash', NOW),
    ).resolves.toBeNull();
  });
});
