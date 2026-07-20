import { describe, expect, it, vi } from 'vitest';

import {
  EmailChallengeService,
  type ActiveChallenge,
  type ChallengeRepository,
  type MailDelivery,
} from '../src/auth/email-challenge-service.js';
import type {
  RateLimitConsumer,
  RateLimitDecision,
} from '../src/security/postgres-rate-limiter.js';

const NOW = new Date('2026-07-19T12:00:00.000Z');
const CHALLENGE_ID = '018f0000-0000-7000-8000-000000000001';

class FakeChallengeRepository implements ChallengeRepository {
  latestCreatedAt: Date | null = null;
  active: ActiveChallenge | null = null;
  pendingIds: string[] = [];
  abandonedIds: string[] = [];
  activatedIds: string[] = [];
  failedAttempts = 0;
  consumedIds: string[] = [];

  async findLatestCreatedAt(): Promise<Date | null> {
    return this.latestCreatedAt;
  }

  async createPending(input: ActiveChallenge): Promise<void> {
    this.pendingIds.push(input.id);
    this.latestCreatedAt = input.createdAt;
    this.active = input;
  }

  async activatePending(id: string): Promise<void> {
    this.activatedIds.push(id);
  }

  async abandonPending(id: string): Promise<void> {
    this.abandonedIds.push(id);
    if (this.active?.id === id) {
      this.active = null;
    }
  }

  async findActive(id: string): Promise<ActiveChallenge | null> {
    return this.active?.id === id ? this.active : null;
  }

  async recordFailedAttempt(
    _id: string,
    maximumAttempts: number,
  ): Promise<{ attempts: number; locked: boolean }> {
    this.failedAttempts += 1;
    return {
      attempts: this.failedAttempts,
      locked: this.failedAttempts >= maximumAttempts,
    };
  }

  async consume(id: string): Promise<boolean> {
    this.consumedIds.push(id);
    return true;
  }
}

class FakeRateLimiter implements RateLimitConsumer {
  decision: RateLimitDecision = { allowed: true };
  inputs: { subjectKey: string; scopes: string[] }[] = [];

  async consume(input: {
    subjectKey: string;
    rules: readonly { scope: string }[];
    now: Date;
  }): Promise<RateLimitDecision> {
    this.inputs.push({
      subjectKey: input.subjectKey,
      scopes: input.rules.map(({ scope }) => scope),
    });
    return this.decision;
  }
}

function mailDelivery(): MailDelivery {
  return {
    sendVerificationCode: vi.fn(async () => undefined),
  };
}

function service(
  repository: FakeChallengeRepository,
  mail: MailDelivery,
  rateLimiter: FakeRateLimiter = new FakeRateLimiter(),
): EmailChallengeService {
  return new EmailChallengeService({
    repository,
    mailDelivery: mail,
    allowedDomains: ['example.edu'],
    hmacSecret: 'test-secret',
    rateLimiter,
    now: () => NOW,
    createId: () => CHALLENGE_ID,
    createCode: () => '123456',
  });
}

describe('EmailChallengeService', () => {
  it('creates, sends, then activates a challenge', async () => {
    const repository = new FakeChallengeRepository();
    const mail = mailDelivery();
    const rateLimiter = new FakeRateLimiter();

    const result = await service(repository, mail, rateLimiter).requestChallenge(
      'Student@example.edu',
    );

    expect(result.challenge_id).toBe(CHALLENGE_ID);
    expect(repository.pendingIds).toEqual([CHALLENGE_ID]);
    expect(repository.activatedIds).toEqual([CHALLENGE_ID]);
    expect(mail.sendVerificationCode).toHaveBeenCalledWith({
      recipient: 'Student@example.edu',
      code: '123456',
      expiresAt: new Date('2026-07-19T12:10:00.000Z'),
    });
    expect(rateLimiter.inputs).toEqual([
      {
        subjectKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        scopes: ['auth_email_minute', 'auth_email_hour', 'auth_email_day'],
      },
    ]);
    expect(JSON.stringify(rateLimiter.inputs)).not.toContain(
      'student@example.edu',
    );
  });

  it('returns a generic persistent rate-limit response before delivery', async () => {
    const repository = new FakeChallengeRepository();
    const mail = mailDelivery();
    const rateLimiter = new FakeRateLimiter();
    rateLimiter.decision = {
      allowed: false,
      retryAfter: 300,
      scope: 'auth_email_hour',
    };

    await expect(
      service(repository, mail, rateLimiter).requestChallenge(
        'student@example.edu',
      ),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Too many verification attempts.',
      retryAfter: 300,
      details: {},
    });
    expect(repository.pendingIds).toEqual([]);
    expect(mail.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('abandons the pending challenge when delivery fails', async () => {
    const repository = new FakeChallengeRepository();
    const mail: MailDelivery = {
      sendVerificationCode: vi.fn(async () => {
        throw new Error('smtp secret');
      }),
    };

    await expect(
      service(repository, mail).requestChallenge('student@example.edu'),
    ).rejects.toMatchObject({
      code: 'temporarily_unavailable',
      message: 'Verification email could not be delivered.',
    });
    expect(repository.abandonedIds).toEqual([CHALLENGE_ID]);
    expect(repository.activatedIds).toEqual([]);
  });

  it('enforces the resend cooldown without revealing account state', async () => {
    const repository = new FakeChallengeRepository();
    repository.latestCreatedAt = new Date(NOW.getTime() - 30_000);

    await expect(
      service(repository, mailDelivery()).requestChallenge(
        'student@example.edu',
      ),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: 30,
    });
  });

  it('consumes a valid active challenge and returns a verified identity', async () => {
    const repository = new FakeChallengeRepository();
    const auth = service(repository, mailDelivery());
    await auth.requestChallenge('Student@example.edu');

    const identity = await auth.verifyChallenge({
      challengeId: CHALLENGE_ID,
      email: 'student@example.edu',
      code: '123456',
    });

    expect(identity).toEqual({
      provider: 'email',
      normalizedSubject: 'student@example.edu',
      subjectDisplay: 'student@example.edu',
    });
    expect(repository.consumedIds).toEqual([CHALLENGE_ID]);
  });

  it('locks the fifth incorrect attempt', async () => {
    const repository = new FakeChallengeRepository();
    const auth = service(repository, mailDelivery());
    await auth.requestChallenge('student@example.edu');

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(
        auth.verifyChallenge({
          challengeId: CHALLENGE_ID,
          email: 'student@example.edu',
          code: '000000',
        }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    }

    await expect(
      auth.verifyChallenge({
        challengeId: CHALLENGE_ID,
        email: 'student@example.edu',
        code: '000000',
      }),
    ).rejects.toMatchObject({ code: 'challenge_locked' });
  });

  it('rejects an expired challenge without comparing the code', async () => {
    const repository = new FakeChallengeRepository();
    const auth = service(repository, mailDelivery());
    await auth.requestChallenge('student@example.edu');
    if (repository.active === null) {
      throw new Error('Expected active challenge.');
    }
    repository.active.expiresAt = new Date(NOW.getTime() - 1);

    await expect(
      auth.verifyChallenge({
        challengeId: CHALLENGE_ID,
        email: 'student@example.edu',
        code: '123456',
      }),
    ).rejects.toMatchObject({ code: 'challenge_expired' });
  });
});
