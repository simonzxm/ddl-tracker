import { describe, expect, it } from 'vitest';

import {
  AccountService,
  type AccountRepository,
  type AuthenticatedPrincipal,
  type PublicUser,
  type SessionRecord,
} from '../src/auth/account-service.js';
import type { VerifiedOidcIdentity } from '../src/auth/oidc-provider-client.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');
const USER_ID = '018f0000-0000-7000-8000-000000000001';
const SESSION_ID = '018f0000-0000-7000-8000-000000000002';
const IDENTITY_ID = '018f0000-0000-7000-8000-000000000003';

const identity: VerifiedOidcIdentity = {
  issuer: 'https://issuer.example',
  subject: 'student-123',
  email: 'Student@smail.example.edu',
  displayName: 'Student Name',
  avatarUrl: 'https://issuer.example/avatar.png',
};

function publicUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: USER_ID,
    username: 'student_existing',
    displayName: 'Student Existing',
    avatarUrl: null,
    bio: null,
    status: 'active',
    profileRevision: 1,
    ...overrides,
  };
}

class FakeAccountRepository implements AccountRepository {
  user: PublicUser | null = null;
  roles: 'maintainer'[] = [];
  sessions: SessionRecord[] = [];
  principal: AuthenticatedPrincipal | null = null;
  createOutcomes: ('identity_exists' | 'username_taken' | 'success')[] = [
    'success',
  ];
  createdAccounts: Parameters<AccountRepository['createOidcAccount']>[0][] = [];
  identityUpdates: Parameters<AccountRepository['updateIdentityLogin']>[0][] = [];
  touches: { id: string; now: Date; expiresAt: Date }[] = [];

  async findUserByIdentity(): Promise<PublicUser | null> {
    return this.user;
  }

  async findRoles(): Promise<'maintainer'[]> {
    return this.roles;
  }

  async createSession(input: SessionRecord): Promise<void> {
    this.sessions.push(input);
  }

  async updateIdentityLogin(
    input: Parameters<AccountRepository['updateIdentityLogin']>[0],
  ): Promise<void> {
    this.identityUpdates.push(input);
  }

  async createOidcAccount(
    input: Parameters<AccountRepository['createOidcAccount']>[0],
  ): Promise<'identity_exists' | 'username_taken' | 'success'> {
    this.createdAccounts.push(input);
    const outcome = this.createOutcomes.shift() ?? 'success';
    if (outcome === 'identity_exists') this.user = publicUser();
    if (outcome === 'success') this.sessions.push(input.session);
    return outcome;
  }

  async findPrincipalBySessionHash(): Promise<AuthenticatedPrincipal | null> {
    return this.principal;
  }

  async touchSession(
    id: string,
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    this.touches.push({ id, now, expiresAt });
  }

  async listSessions(): Promise<SessionRecord[]> {
    return this.sessions;
  }

  async revokeSession(): Promise<boolean> {
    return true;
  }

  async revokeAllSessions(): Promise<number> {
    return this.sessions.length;
  }
}

function service(
  repository: FakeAccountRepository,
  options: { ids?: string[]; secrets?: string[]; now?: Date } = {},
): AccountService {
  const ids = [...(options.ids ?? [USER_ID, SESSION_ID, IDENTITY_ID])];
  const secrets = [...(options.secrets ?? ['session-secret'])];
  return new AccountService({
    repository,
    tokenPepper: 'p'.repeat(64),
    now: () => options.now ?? NOW,
    createId: () => {
      const value = ids.shift();
      if (value === undefined) throw new Error('No test ID available.');
      return value;
    },
    createSecret: () => {
      const value = secrets.shift();
      if (value === undefined) throw new Error('No test secret available.');
      return value;
    },
  });
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    tokenHash: 'hash',
    deviceName: null,
    deviceMetadata: {},
    createdAt: NOW,
    lastSeenAt: NOW,
    idleExpiresAt: new Date('2026-08-29T12:00:00.000Z'),
    absoluteExpiresAt: new Date('2027-01-26T12:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

describe('AccountService OIDC sign-in', () => {
  it('auto-provisions a public profile, OIDC identity and local session', async () => {
    const repository = new FakeAccountRepository();
    const result = await service(repository).signInWithOidc(identity, {
      deviceName: 'MacBook',
      deviceMetadata: { platform: 'macos' },
    });

    expect(result).toMatchObject({
      kind: 'session',
      access_token: 'session-secret',
      token_type: 'Bearer',
      user: {
        id: USER_ID,
        displayName: 'Student Name',
        avatarUrl: 'https://issuer.example/avatar.png',
      },
      roles: [],
    });
    expect(result.user.username).toMatch(/^student_[a-z0-9]{8}$/u);
    expect(repository.createdAccounts).toHaveLength(1);
    expect(repository.createdAccounts[0]).toMatchObject({
      identityId: IDENTITY_ID,
      identity,
      session: {
        id: SESSION_ID,
        deviceName: 'MacBook',
        deviceMetadata: { platform: 'macos' },
      },
    });
    expect(repository.createdAccounts[0]?.session.tokenHash).not.toBe(
      'session-secret',
    );
  });

  it('issues a fresh local session for an existing active identity', async () => {
    const repository = new FakeAccountRepository();
    repository.user = publicUser();
    repository.roles = ['maintainer'];
    const result = await service(repository, {
      ids: [SESSION_ID],
      secrets: ['existing-session'],
    }).signInWithOidc(identity, { deviceName: null, deviceMetadata: {} });

    expect(result).toMatchObject({
      access_token: 'existing-session',
      user: publicUser(),
      roles: ['maintainer'],
    });
    expect(repository.sessions).toHaveLength(1);
    expect(repository.identityUpdates).toEqual([
      expect.objectContaining({
        issuer: identity.issuer,
        subject: identity.subject,
        email: identity.email,
        userId: USER_ID,
      }),
    ]);
  });

  it('retries deterministic username collisions without changing identity', async () => {
    const repository = new FakeAccountRepository();
    repository.createOutcomes = ['username_taken', 'success'];
    const ids = [
      USER_ID,
      SESSION_ID,
      IDENTITY_ID,
      '018f0000-0000-7000-8000-000000000004',
      '018f0000-0000-7000-8000-000000000005',
      '018f0000-0000-7000-8000-000000000006',
    ];
    await service(repository, {
      ids,
      secrets: ['first-session', 'second-session'],
    }).signInWithOidc(identity, { deviceName: null, deviceMetadata: {} });

    expect(repository.createdAccounts).toHaveLength(2);
    expect(repository.createdAccounts[0]?.user.username).not.toBe(
      repository.createdAccounts[1]?.user.username,
    );
    expect(repository.createdAccounts.map((value) => value.identity)).toEqual([
      identity,
      identity,
    ]);
  });

  it('rejects suspended identities before issuing a session', async () => {
    const repository = new FakeAccountRepository();
    repository.user = publicUser({ status: 'suspended' });
    await expect(
      service(repository).signInWithOidc(identity, {
        deviceName: null,
        deviceMetadata: {},
      }),
    ).rejects.toMatchObject({ code: 'account_suspended' });
    expect(repository.sessions).toHaveLength(0);
  });
});

describe('AccountService local sessions', () => {
  it('authenticates an active session and refreshes stale last-seen state', async () => {
    const repository = new FakeAccountRepository();
    repository.principal = {
      user: publicUser(),
      roles: [],
      session: session({
        lastSeenAt: new Date('2026-07-30T11:00:00.000Z'),
      }),
    };
    const principal = await service(repository, { ids: [], secrets: [] }).authenticate(
      'opaque-session',
    );
    expect(principal.user.id).toBe(USER_ID);
    expect(repository.touches).toHaveLength(1);
  });

  it('rejects missing, expired, revoked and deleted sessions', async () => {
    for (const principal of [
      null,
      { user: publicUser(), roles: [], session: session({ revokedAt: NOW }) },
      {
        user: publicUser(),
        roles: [],
        session: session({ idleExpiresAt: new Date('2026-07-30T11:59:59Z') }),
      },
      { user: publicUser({ status: 'deleted' }), roles: [], session: session() },
    ] satisfies (AuthenticatedPrincipal | null)[]) {
      const repository = new FakeAccountRepository();
      repository.principal = principal;
      await expect(
        service(repository, { ids: [], secrets: [] }).authenticate('token'),
      ).rejects.toMatchObject({ code: 'unauthenticated' });
    }
  });
});
