import { createUuidV7 } from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';
import type { RateLimitConsumer } from '../security/postgres-rate-limiter.js';
import {
  constantTimeEqual,
  createNumericCode,
  hmacSha256,
  normalizeInstitutionalEmail,
} from './primitives.js';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAXIMUM_ATTEMPTS = 5;
const EMAIL_RATE_LIMIT_RULES = [
  { scope: 'auth_email_minute', limit: 1, windowSeconds: 60 },
  { scope: 'auth_email_hour', limit: 5, windowSeconds: 60 * 60 },
  { scope: 'auth_email_day', limit: 10, windowSeconds: 24 * 60 * 60 },
] as const;

export interface MailDelivery {
  sendVerificationCode(input: {
    recipient: string;
    code: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface ActiveChallenge {
  id: string;
  provider: 'email';
  normalizedSubject: string;
  subjectDisplay: string;
  codeHmac: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface ChallengeRepository {
  findLatestCreatedAt(
    provider: 'email',
    normalizedSubject: string,
  ): Promise<Date | null>;
  createPending(input: ActiveChallenge): Promise<void>;
  activatePending(
    id: string,
    provider: 'email',
    normalizedSubject: string,
  ): Promise<void>;
  abandonPending(id: string): Promise<void>;
  findActive(
    id: string,
    provider: 'email',
    normalizedSubject: string,
  ): Promise<ActiveChallenge | null>;
  recordFailedAttempt(
    id: string,
    maximumAttempts: number,
  ): Promise<{ attempts: number; locked: boolean }>;
  consume(id: string): Promise<boolean>;
}

export interface VerifiedInstitutionalIdentity {
  provider: 'email';
  normalizedSubject: string;
  subjectDisplay: string;
}

export class EmailChallengeService {
  readonly #repository: ChallengeRepository;
  readonly #mailDelivery: MailDelivery;
  readonly #allowedDomains: readonly string[];
  readonly #hmacSecret: string;
  readonly #rateLimiter: RateLimitConsumer;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #createCode: () => string;

  constructor(options: {
    repository: ChallengeRepository;
    mailDelivery: MailDelivery;
    allowedDomains: readonly string[];
    hmacSecret: string;
    rateLimiter: RateLimitConsumer;
    now?: () => Date;
    createId?: () => string;
    createCode?: () => string;
  }) {
    this.#repository = options.repository;
    this.#mailDelivery = options.mailDelivery;
    this.#allowedDomains = options.allowedDomains;
    this.#hmacSecret = options.hmacSecret;
    this.#rateLimiter = options.rateLimiter;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? createUuidV7;
    this.#createCode = options.createCode ?? createNumericCode;
  }

  async requestChallenge(email: string): Promise<{
    challenge_id: string;
    expires_at: string;
  }> {
    let identity: { normalized: string; display: string };
    try {
      identity = normalizeInstitutionalEmail(email, this.#allowedDomains);
    } catch {
      throw new HttpError({
        code: 'invalid_request',
        message: 'A valid institutional email is required.',
        status: 400,
      });
    }

    const now = this.#now();
    const subjectKey = await hmacSha256(
      this.#hmacSecret,
      `email-rate-limit\u0000${identity.normalized}`,
    );
    const rateLimit = await this.#rateLimiter.consume({
      subjectKey,
      rules: EMAIL_RATE_LIMIT_RULES,
      now,
    });
    if (!rateLimit.allowed) {
      throw new HttpError({
        code: 'rate_limited',
        message: 'Too many verification attempts.',
        retryable: true,
        retryAfter: rateLimit.retryAfter,
        status: 429,
      });
    }

    const latestCreatedAt = await this.#repository.findLatestCreatedAt(
      'email',
      identity.normalized,
    );
    if (latestCreatedAt !== null) {
      const elapsed = now.getTime() - latestCreatedAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        throw new HttpError({
          code: 'rate_limited',
          message: 'Too many verification attempts.',
          retryable: true,
          retryAfter: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000),
          status: 429,
        });
      }
    }

    const id = this.#createId();
    const code = this.#createCode();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const codeHmac = await hmacSha256(
      this.#hmacSecret,
      `${id}\u0000${identity.normalized}\u0000${code}`,
    );
    await this.#repository.createPending({
      id,
      provider: 'email',
      normalizedSubject: identity.normalized,
      subjectDisplay: identity.display,
      codeHmac,
      attempts: 0,
      expiresAt,
      createdAt: now,
    });

    try {
      await this.#mailDelivery.sendVerificationCode({
        recipient: identity.display,
        code,
        expiresAt,
      });
    } catch {
      await this.#repository.abandonPending(id);
      throw new HttpError({
        code: 'temporarily_unavailable',
        message: 'Verification email could not be delivered.',
        retryable: true,
        status: 503,
      });
    }

    await this.#repository.activatePending(
      id,
      'email',
      identity.normalized,
    );
    return {
      challenge_id: id,
      expires_at: expiresAt.toISOString(),
    };
  }

  async verifyChallenge(input: {
    challengeId: string;
    email: string;
    code: string;
  }): Promise<VerifiedInstitutionalIdentity> {
    let identity: { normalized: string; display: string };
    try {
      identity = normalizeInstitutionalEmail(input.email, this.#allowedDomains);
    } catch {
      throw new HttpError({
        code: 'invalid_request',
        message: 'Challenge verification failed.',
        status: 400,
      });
    }

    const challenge = await this.#repository.findActive(
      input.challengeId,
      'email',
      identity.normalized,
    );
    if (challenge === null || challenge.expiresAt.getTime() <= this.#now().getTime()) {
      throw new HttpError({
        code: 'challenge_expired',
        message: 'Verification challenge is no longer active.',
        status: 400,
      });
    }
    if (challenge.attempts >= MAXIMUM_ATTEMPTS) {
      throw new HttpError({
        code: 'challenge_locked',
        message: 'Verification challenge is locked.',
        status: 400,
      });
    }

    const providedHmac = await hmacSha256(
      this.#hmacSecret,
      `${challenge.id}\u0000${challenge.normalizedSubject}\u0000${input.code}`,
    );
    if (!constantTimeEqual(challenge.codeHmac, providedHmac)) {
      const attempt = await this.#repository.recordFailedAttempt(
        challenge.id,
        MAXIMUM_ATTEMPTS,
      );
      throw new HttpError({
        code: attempt.locked ? 'challenge_locked' : 'invalid_request',
        message: attempt.locked
          ? 'Verification challenge is locked.'
          : 'Challenge verification failed.',
        status: 400,
      });
    }

    const consumed = await this.#repository.consume(challenge.id);
    if (!consumed) {
      throw new HttpError({
        code: 'challenge_expired',
        message: 'Verification challenge is no longer active.',
        status: 400,
      });
    }

    return {
      provider: 'email',
      normalizedSubject: identity.normalized,
      subjectDisplay: identity.display,
    };
  }
}
