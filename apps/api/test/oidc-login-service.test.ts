import { describe, expect, it, vi } from 'vitest';

import {
  OidcLoginService,
  type OidcLoginRepository,
  type OidcLoginTransaction,
} from '../src/auth/oidc-login-service.js';
import type {
  OidcProvider,
  VerifiedOidcIdentity,
} from '../src/auth/oidc-provider-client.js';
import { hmacSha256, sha256 } from '../src/auth/primitives.js';
import type { RateLimitConsumer } from '../src/security/postgres-rate-limiter.js';

const TRANSACTION_ID = '018f0000-0000-7000-8000-000000000001';
const NOW = new Date('2026-07-30T12:00:00.000Z');
const SECRET = 'x'.repeat(64);
const verifiedIdentity: VerifiedOidcIdentity = {
  issuer: 'https://issuer.example',
  subject: 'student-123',
  email: 'student@example.edu',
  displayName: 'Student',
  avatarUrl: null,
};

class FakeRepository implements OidcLoginRepository {
  transaction: OidcLoginTransaction | null = null;

  async createPending(input: OidcLoginTransaction): Promise<void> {
    this.transaction = structuredClone(input);
  }

  async findById(id: string): Promise<OidcLoginTransaction | null> {
    return this.transaction?.id === id ? structuredClone(this.transaction) : null;
  }

  async claim(id: string, now: Date): Promise<boolean> {
    if (
      this.transaction?.id !== id ||
      this.transaction.status !== 'pending' ||
      this.transaction.expiresAt.getTime() <= now.getTime()
    ) {
      return false;
    }
    this.transaction = { ...this.transaction, status: 'exchanging' };
    return true;
  }

  async complete(
    input: Parameters<OidcLoginRepository['complete']>[0],
  ): Promise<boolean> {
    if (
      this.transaction?.id !== input.id ||
      this.transaction.status !== 'exchanging'
    ) {
      return false;
    }
    this.transaction = {
      ...this.transaction,
      status: 'completed',
      secretsCiphertext: null,
      issuer: input.identity.issuer,
      subject: input.identity.subject,
      email: input.identity.email,
      displayName: input.identity.displayName,
      avatarUrl: input.identity.avatarUrl,
      exchangeCodeHash: input.exchangeCodeHash,
      expiresAt: input.expiresAt,
      completedAt: input.now,
    };
    return true;
  }

  async fail(id: string, now: Date, errorCode: string): Promise<void> {
    if (
      this.transaction?.id !== id ||
      !['pending', 'exchanging'].includes(this.transaction.status)
    ) {
      return;
    }
    this.transaction = {
      ...this.transaction,
      status: 'failed',
      secretsCiphertext: null,
      errorCode,
      completedAt: now,
    };
  }

  async consume(id: string, now: Date): Promise<boolean> {
    if (
      this.transaction?.id !== id ||
      this.transaction.status !== 'completed' ||
      this.transaction.expiresAt.getTime() <= now.getTime()
    ) {
      return false;
    }
    this.transaction = {
      ...this.transaction,
      status: 'consumed',
      exchangeCodeHash: null,
      consumedAt: now,
    };
    return true;
  }
}

function provider(): OidcProvider & {
  createAuthorizationUrl: ReturnType<typeof vi.fn>;
  exchangeAuthorizationCode: ReturnType<typeof vi.fn>;
} {
  return {
    createAuthorizationUrl: vi.fn(async (input) => {
      const url = new URL('https://issuer.example/oauth2/authorize');
      url.searchParams.set('state', input.state);
      url.searchParams.set('nonce', input.nonce);
      url.searchParams.set('code_challenge', input.codeChallenge);
      return url.toString();
    }),
    exchangeAuthorizationCode: vi.fn(async () => verifiedIdentity),
  };
}

function rateLimiter(decision: Awaited<ReturnType<RateLimitConsumer['consume']>> = {
  allowed: true,
}): RateLimitConsumer & { consume: ReturnType<typeof vi.fn> } {
  return { consume: vi.fn(async () => decision) };
}

function createService(options: {
  repository?: FakeRepository;
  oidcProvider?: ReturnType<typeof provider>;
  limiter?: ReturnType<typeof rateLimiter>;
  secrets?: string[];
  now?: Date | (() => Date);
} = {}) {
  const repository = options.repository ?? new FakeRepository();
  const oidcProvider = options.oidcProvider ?? provider();
  const testNow = options.now;
  const limiter = options.limiter ?? rateLimiter();
  const secrets = [
    ...(options.secrets ?? [
      'state-secret',
      'nonce-secret',
      'verifier-secret',
      'exchange-secret',
    ]),
  ];
  return {
    repository,
    oidcProvider,
    limiter,
    service: new OidcLoginService({
      repository,
      provider: oidcProvider,
      allowedRedirectUris: ['https://app.example/auth/callback'],
      transactionSecret: SECRET,
      rateLimiter: limiter,
      now:
        typeof testNow === 'function'
          ? testNow
          : () => testNow ?? NOW,
      createId: () => TRANSACTION_ID,
      createSecret: () => {
        const value = secrets.shift();
        if (value === undefined) throw new Error('No test secret available.');
        return value;
      },
    }),
  };
}

async function begin(
  fixture: ReturnType<typeof createService>,
): Promise<{ state: string; authorizationUrl: string }> {
  const result = await fixture.service.beginAuthorization({
    redirectUri: 'https://app.example/auth/callback',
    sourceIp: '192.0.2.1',
  });
  const url = new URL(result.authorization_url);
  return { state: url.searchParams.get('state') ?? '', authorizationUrl: url.toString() };
}

describe('OidcLoginService', () => {
  it('creates a rate-limited PKCE authorization transaction without storing plaintext state', async () => {
    const fixture = createService();
    const result = await begin(fixture);

    expect(result.state).toBe(`${TRANSACTION_ID}.state-secret`);
    expect(new URL(result.authorizationUrl).searchParams.get('nonce')).toBe(
      'nonce-secret',
    );
    expect(
      new URL(result.authorizationUrl).searchParams.get('code_challenge'),
    ).toBe(await sha256('verifier-secret'));
    expect(fixture.repository.transaction).toMatchObject({
      id: TRANSACTION_ID,
      redirectUri: 'https://app.example/auth/callback',
      status: 'pending',
      expiresAt: new Date('2026-07-30T12:10:00.000Z'),
    });
    expect(fixture.repository.transaction?.stateHash).toBe(
      await hmacSha256(SECRET, result.state),
    );
    expect(fixture.repository.transaction?.stateHash).not.toContain('state-secret');
    expect(fixture.repository.transaction?.secretsCiphertext).not.toContain(
      'verifier-secret',
    );
    expect(fixture.limiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: expect.arrayContaining([
          expect.objectContaining({ scope: 'auth_oidc_ip_hour' }),
        ]),
        now: NOW,
      }),
    );
  });

  it('rejects redirects outside the exact deployment allowlist', async () => {
    const fixture = createService();
    await expect(
      fixture.service.beginAuthorization({
        redirectUri: 'https://evil.example/callback',
        sourceIp: '192.0.2.1',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fixture.repository.transaction).toBeNull();
  });

  it('returns persistent login rate-limit errors before creating transactions', async () => {
    const fixture = createService({
      limiter: rateLimiter({
        allowed: false,
        retryAfter: 42,
        scope: 'auth_oidc_ip_hour',
      }),
    });
    await expect(
      fixture.service.beginAuthorization({
        redirectUri: 'https://app.example/auth/callback',
        sourceIp: '192.0.2.1',
      }),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: 42,
    });
    expect(fixture.repository.transaction).toBeNull();
  });

  it('verifies state, exchanges the provider code and returns a one-time local code', async () => {
    const fixture = createService();
    const { state } = await begin(fixture);
    const result = await fixture.service.completeAuthorization({
      state,
      code: 'provider-code',
      providerError: null,
    });

    expect(result).toEqual({
      kind: 'success',
      redirectUri: 'https://app.example/auth/callback',
      exchangeCode: `${TRANSACTION_ID}.exchange-secret`,
    });
    expect(fixture.oidcProvider.exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: 'provider-code',
      codeVerifier: 'verifier-secret',
      nonce: 'nonce-secret',
    });
    expect(fixture.repository.transaction).toMatchObject({
      status: 'completed',
      issuer: verifiedIdentity.issuer,
      subject: verifiedIdentity.subject,
      secretsCiphertext: null,
      exchangeCodeHash: await hmacSha256(
        SECRET,
        `${TRANSACTION_ID}.exchange-secret`,
      ),
    });
  });

  it('gives the exchange code a full lifetime from callback completion', async () => {
    let currentTime = NOW;
    const fixture = createService({ now: () => currentTime });
    const { state } = await begin(fixture);
    currentTime = new Date('2026-07-30T12:09:00.000Z');

    await fixture.service.completeAuthorization({
      state,
      code: 'provider-code',
      providerError: null,
    });

    expect(fixture.repository.transaction?.expiresAt).toEqual(
      new Date('2026-07-30T12:19:00.000Z'),
    );
  });

  it('rejects tampered state without calling the provider', async () => {
    const fixture = createService();
    const { state } = await begin(fixture);
    await expect(
      fixture.service.completeAuthorization({
        state: `${state}tampered`,
        code: 'provider-code',
        providerError: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fixture.oidcProvider.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('claims the transaction before exchange so a duplicate callback is rejected', async () => {
    const fixture = createService();
    const { state } = await begin(fixture);
    await fixture.service.completeAuthorization({
      state,
      code: 'provider-code',
      providerError: null,
    });
    await expect(
      fixture.service.completeAuthorization({
        state,
        code: 'provider-code',
        providerError: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fixture.oidcProvider.exchangeAuthorizationCode).toHaveBeenCalledOnce();
  });

  it('records provider rejection and redirects only a normalized public error', async () => {
    const fixture = createService();
    const { state } = await begin(fixture);
    await expect(
      fixture.service.completeAuthorization({
        state,
        code: null,
        providerError: 'access denied<script>',
      }),
    ).resolves.toEqual({
      kind: 'error',
      redirectUri: 'https://app.example/auth/callback',
      error: 'access_denied',
    });
    expect(fixture.repository.transaction).toMatchObject({
      status: 'failed',
      errorCode: 'access_denied',
    });
  });

  it('consumes a valid exchange code exactly once', async () => {
    const fixture = createService();
    const { state } = await begin(fixture);
    const completed = await fixture.service.completeAuthorization({
      state,
      code: 'provider-code',
      providerError: null,
    });
    if (completed.kind !== 'success') throw new Error('Expected success.');

    await expect(
      fixture.service.consumeExchangeCode(completed.exchangeCode),
    ).resolves.toEqual(verifiedIdentity);
    await expect(
      fixture.service.consumeExchangeCode(completed.exchangeCode),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
