import { describe, expect, it } from 'vitest';

import {
  AccountService,
  type AccountRepository,
  type AuthenticatedPrincipal,
  type PublicUser,
  type RegistrationIdentity,
  type SessionRecord,
} from '../src/auth/account-service.js';

const NOW = new Date('2026-07-19T12:00:00.000Z');
const USER_ID = '018f0000-0000-7000-8000-000000000010';
const SESSION_ID = '018f0000-0000-7000-8000-000000000011';
const REGISTRATION_ID = '018f0000-0000-7000-8000-000000000012';

const user: PublicUser = {
  id: USER_ID,
  username: 'student',
  displayName: 'Student',
  status: 'active',
  profileRevision: 1,
};

class FakeAccountRepository implements AccountRepository {
  accountByIdentity: PublicUser | null = null;
  registration: RegistrationIdentity | null = null;
  sessionPrincipal: AuthenticatedPrincipal | null = null;
  sessions: SessionRecord[] = [];
  registrationOutcome: 'invalid' | 'username_taken' | 'success' = 'success';

  async findUserByIdentity(): Promise<PublicUser | null> {
    return this.accountByIdentity;
  }

  async saveRegistrationIdentity(input: RegistrationIdentity): Promise<void> {
    this.registration = input;
  }

  async createSession(input: SessionRecord): Promise<void> {
    this.sessions.push(input);
  }

  async registerAccount(input: {
    registrationTokenHash: string;
    now: Date;
    user: PublicUser;
    identityId: string;
    session: SessionRecord;
  }): Promise<'invalid' | 'username_taken' | 'success'> {
    if (this.registrationOutcome === 'success') {
      this.sessions.push(input.session);
      this.accountByIdentity = input.user;
    }
    return this.registrationOutcome;
  }

  async findPrincipalBySessionHash(): Promise<AuthenticatedPrincipal | null> {
    return this.sessionPrincipal;
  }

  touchSession(): Promise<void> {
    return Promise.resolve();
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
  sequences?: { ids: string[]; secrets: string[] },
): AccountService {
  const ids = sequences?.ids ?? [
    REGISTRATION_ID,
    USER_ID,
    SESSION_ID,
    '018f0000-0000-7000-8000-000000000013',
  ];
  const secrets = sequences?.secrets ?? [
    'registration-secret',
    'session-secret',
  ];
  return new AccountService({
    repository,
    tokenPepper: 'pepper',
    now: () => NOW,
    createId: () => {
      const id = ids.shift();
      if (id === undefined) throw new Error('No ID');
      return id;
    },
    createSecret: () => {
      const secret = secrets.shift();
      if (secret === undefined) throw new Error('No secret');
      return secret;
    },
  });
}

const identity = {
  provider: 'email' as const,
  normalizedSubject: 'student@example.edu',
  subjectDisplay: 'student@example.edu',
};

describe('AccountService', () => {
  it('returns a registration token for a new identity', async () => {
    const repository = new FakeAccountRepository();

    const result = await service(repository).completeVerification(identity, {
      deviceName: 'MacBook',
      deviceMetadata: { platform: 'macOS' },
    });

    expect(result).toEqual({
      kind: 'registration',
      registration_token: 'registration-secret',
      expires_at: '2026-07-19T12:15:00.000Z',
    });
    expect(repository.registration).toMatchObject({
      id: REGISTRATION_ID,
      normalizedSubject: 'student@example.edu',
    });
    expect(repository.registration?.tokenHash).not.toBe('registration-secret');
  });

  it('returns a device session for an existing active identity', async () => {
    const repository = new FakeAccountRepository();
    repository.accountByIdentity = user;

    const result = await service(repository).completeVerification(identity, {
      deviceName: 'MacBook',
      deviceMetadata: {},
    });

    expect(result).toMatchObject({
      kind: 'session',
      access_token: 'registration-secret',
      token_type: 'Bearer',
      user,
    });
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0]).toMatchObject({
      userId: USER_ID,
      idleExpiresAt: new Date('2026-08-18T12:00:00.000Z'),
      absoluteExpiresAt: new Date('2027-01-15T12:00:00.000Z'),
    });
  });

  it('blocks login for a suspended account', async () => {
    const repository = new FakeAccountRepository();
    repository.accountByIdentity = { ...user, status: 'suspended' };

    await expect(
      service(repository).completeVerification(identity, {
        deviceName: null,
        deviceMetadata: {},
      }),
    ).rejects.toMatchObject({ code: 'account_suspended' });
  });

  it('registers a new account and returns its first session', async () => {
    const repository = new FakeAccountRepository();
    const result = await service(repository, {
      ids: [USER_ID, SESSION_ID, REGISTRATION_ID],
      secrets: ['session-secret'],
    }).register({
      registrationToken: 'registration-token',
      username: 'new_user',
      displayName: 'New User',
      deviceName: 'Phone',
      deviceMetadata: {},
    });

    expect(result).toMatchObject({
      access_token: 'session-secret',
      token_type: 'Bearer',
      user: {
        id: USER_ID,
        username: 'new_user',
        displayName: 'New User',
      },
    });
  });

  it('maps registration token and username conflicts to stable errors', async () => {
    const invalidRepository = new FakeAccountRepository();
    invalidRepository.registrationOutcome = 'invalid';
    await expect(
      service(invalidRepository).register({
        registrationToken: 'token',
        username: 'valid_name',
        displayName: null,
        deviceName: null,
        deviceMetadata: {},
      }),
    ).rejects.toMatchObject({ code: 'registration_token_invalid' });

    const conflictRepository = new FakeAccountRepository();
    conflictRepository.registrationOutcome = 'username_taken';
    await expect(
      service(conflictRepository).register({
        registrationToken: 'token',
        username: 'valid_name',
        displayName: null,
        deviceName: null,
        deviceMetadata: {},
      }),
    ).rejects.toMatchObject({ code: 'username_taken' });
  });

  it('authenticates only active, unexpired sessions and throttles last seen updates', async () => {
    const repository = new FakeAccountRepository();
    repository.sessionPrincipal = {
      user,
      session: {
        id: SESSION_ID,
        userId: USER_ID,
        tokenHash: 'hash',
        deviceName: null,
        deviceMetadata: {},
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        lastSeenAt: new Date('2026-07-19T11:00:00.000Z'),
        idleExpiresAt: new Date('2026-08-18T11:00:00.000Z'),
        absoluteExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
        revokedAt: null,
      },
      roles: [],
    };

    const principal = await service(repository).authenticate('session-token');

    expect(principal.user.id).toBe(USER_ID);
  });
});
