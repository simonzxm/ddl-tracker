import { createUuidV7 } from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';
import type {
  RateLimitConsumer,
  RateLimitRule,
} from '../security/postgres-rate-limiter.js';
import {
  constantTimeEqual,
  createOpaqueSecret,
  hmacSha256,
  openJson,
  sealJson,
  sha256,
} from './primitives.js';
import type {
  OidcProvider,
  VerifiedOidcIdentity,
} from './oidc-provider-client.js';

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_CODE_TTL_MS = 10 * 60 * 1000;
const START_RATE_LIMIT_RULES = [
  { scope: 'auth_oidc_ip_hour', limit: 20, windowSeconds: 60 * 60 },
  { scope: 'auth_oidc_ip_day', limit: 50, windowSeconds: 24 * 60 * 60 },
] as const satisfies readonly RateLimitRule[];

export type OidcLoginStatus =
  | 'pending'
  | 'exchanging'
  | 'completed'
  | 'consumed'
  | 'failed';

export interface OidcLoginTransaction {
  id: string;
  stateHash: string;
  secretsCiphertext: string | null;
  redirectUri: string;
  status: OidcLoginStatus;
  issuer: string | null;
  subject: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  exchangeCodeHash: string | null;
  errorCode: string | null;
  expiresAt: Date;
  createdAt: Date;
  completedAt: Date | null;
  consumedAt: Date | null;
}

export interface OidcLoginRepository {
  createPending(input: OidcLoginTransaction): Promise<void>;
  findById(id: string): Promise<OidcLoginTransaction | null>;
  claim(id: string, now: Date): Promise<boolean>;
  complete(input: {
    id: string;
    now: Date;
    expiresAt: Date;
    identity: VerifiedOidcIdentity;
    exchangeCodeHash: string;
  }): Promise<boolean>;
  fail(id: string, now: Date, errorCode: string): Promise<void>;
  consume(id: string, now: Date): Promise<boolean>;
}

export type OidcCallbackResult =
  | { redirectUri: string; kind: 'success'; exchangeCode: string }
  | { redirectUri: string; kind: 'error'; error: string };

interface PendingSecrets {
  nonce: string;
  codeVerifier: string;
}

export class OidcLoginService {
  readonly #repository: OidcLoginRepository;
  readonly #provider: OidcProvider;
  readonly #allowedRedirectUris: Set<string>;
  readonly #transactionSecret: string;
  readonly #rateLimiter: RateLimitConsumer;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #createSecret: () => string;

  constructor(options: {
    repository: OidcLoginRepository;
    provider: OidcProvider;
    allowedRedirectUris: readonly string[];
    transactionSecret: string;
    rateLimiter: RateLimitConsumer;
    now?: () => Date;
    createId?: () => string;
    createSecret?: () => string;
  }) {
    this.#repository = options.repository;
    this.#provider = options.provider;
    this.#allowedRedirectUris = new Set(
      options.allowedRedirectUris.map(normalizeRedirectUri),
    );
    if (this.#allowedRedirectUris.size === 0) {
      throw new Error('At least one OIDC post-login redirect URI is required.');
    }
    this.#transactionSecret = options.transactionSecret;
    this.#rateLimiter = options.rateLimiter;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? createUuidV7;
    this.#createSecret = options.createSecret ?? createOpaqueSecret;
  }

  async beginAuthorization(input: {
    redirectUri: string;
    sourceIp: string;
  }): Promise<{ authorization_url: string; expires_at: string }> {
    const now = this.#now();
    await this.#consumeRateLimit(input.sourceIp, now);
    const redirectUri = normalizeRedirectUri(input.redirectUri);
    if (!this.#allowedRedirectUris.has(redirectUri)) {
      throw new HttpError({
        code: 'invalid_request',
        message: 'Redirect URI is not allowed.',
        status: 400,
      });
    }

    const id = this.#createId();
    const state = `${id}.${this.#createSecret()}`;
    const secrets: PendingSecrets = {
      nonce: this.#createSecret(),
      codeVerifier: this.#createSecret(),
    };
    const expiresAt = new Date(now.getTime() + TRANSACTION_TTL_MS);
    const transaction: OidcLoginTransaction = {
      id,
      stateHash: await hmacSha256(this.#transactionSecret, state),
      secretsCiphertext: await sealJson(this.#transactionSecret, secrets),
      redirectUri,
      status: 'pending',
      issuer: null,
      subject: null,
      email: null,
      displayName: null,
      avatarUrl: null,
      exchangeCodeHash: null,
      errorCode: null,
      expiresAt,
      createdAt: now,
      completedAt: null,
      consumedAt: null,
    };
    await this.#repository.createPending(transaction);

    try {
      return {
        authorization_url: await this.#provider.createAuthorizationUrl({
          state,
          nonce: secrets.nonce,
          codeChallenge: await sha256(secrets.codeVerifier),
        }),
        expires_at: expiresAt.toISOString(),
      };
    } catch {
      await this.#repository.fail(id, now, 'provider_unavailable');
      throw new HttpError({
        code: 'temporarily_unavailable',
        message: 'OIDC provider is temporarily unavailable.',
        retryable: true,
        status: 503,
      });
    }
  }

  async completeAuthorization(input: {
    state: string | null;
    code: string | null;
    providerError: string | null;
  }): Promise<OidcCallbackResult> {
    const state = input.state ?? '';
    const id = credentialId(state);
    const transaction = await this.#repository.findById(id);
    const now = this.#now();
    if (
      transaction?.status !== 'pending' ||
      transaction.expiresAt.getTime() <= now.getTime() ||
      transaction.secretsCiphertext === null ||
      !constantTimeEqual(
        transaction.stateHash,
        await hmacSha256(this.#transactionSecret, state),
      )
    ) {
      throw invalidAuthorization();
    }

    if (input.providerError !== null) {
      const error = normalizeProviderError(input.providerError);
      await this.#repository.fail(transaction.id, now, error);
      return { redirectUri: transaction.redirectUri, kind: 'error', error };
    }
    if (input.code === null || input.code.trim() === '') {
      await this.#repository.fail(transaction.id, now, 'invalid_response');
      return {
        redirectUri: transaction.redirectUri,
        kind: 'error',
        error: 'invalid_response',
      };
    }
    if (!(await this.#repository.claim(transaction.id, now))) {
      throw invalidAuthorization();
    }

    let identity: VerifiedOidcIdentity;
    try {
      const secrets = await openJson<PendingSecrets>(
        this.#transactionSecret,
        transaction.secretsCiphertext,
      );
      if (
        typeof secrets.nonce !== 'string' ||
        typeof secrets.codeVerifier !== 'string'
      ) {
        throw new Error('OIDC transaction secrets are invalid.');
      }
      identity = await this.#provider.exchangeAuthorizationCode({
        code: input.code,
        codeVerifier: secrets.codeVerifier,
        nonce: secrets.nonce,
      });
    } catch {
      await this.#repository.fail(transaction.id, now, 'oidc_failed');
      return {
        redirectUri: transaction.redirectUri,
        kind: 'error',
        error: 'oidc_failed',
      };
    }

    const completedAt = this.#now();
    const exchangeCode = `${transaction.id}.${this.#createSecret()}`;
    const completed = await this.#repository.complete({
      id: transaction.id,
      now: completedAt,
      expiresAt: new Date(completedAt.getTime() + EXCHANGE_CODE_TTL_MS),
      identity,
      exchangeCodeHash: await hmacSha256(
        this.#transactionSecret,
        exchangeCode,
      ),
    });
    if (!completed) throw invalidAuthorization();
    return {
      redirectUri: transaction.redirectUri,
      kind: 'success',
      exchangeCode,
    };
  }

  async consumeExchangeCode(code: string): Promise<VerifiedOidcIdentity> {
    const id = credentialId(code);
    const transaction = await this.#repository.findById(id);
    const now = this.#now();
    if (
      transaction?.status !== 'completed' ||
      transaction.expiresAt.getTime() <= now.getTime() ||
      transaction.exchangeCodeHash === null ||
      transaction.issuer === null ||
      transaction.subject === null ||
      !constantTimeEqual(
        transaction.exchangeCodeHash,
        await hmacSha256(this.#transactionSecret, code),
      )
    ) {
      throw invalidExchange();
    }
    if (!(await this.#repository.consume(transaction.id, now))) {
      throw invalidExchange();
    }
    return {
      issuer: transaction.issuer,
      subject: transaction.subject,
      email: transaction.email,
      displayName: transaction.displayName,
      avatarUrl: transaction.avatarUrl,
    };
  }

  async #consumeRateLimit(sourceIp: string, now: Date): Promise<void> {
    const subjectKey = await hmacSha256(
      this.#transactionSecret,
      `oidc-start\u0000${sourceIp}`,
    );
    const result = await this.#rateLimiter.consume({
      subjectKey,
      rules: START_RATE_LIMIT_RULES,
      now,
    });
    if (result.allowed) return;
    throw new HttpError({
      code: 'rate_limited',
      message: 'Too many login attempts.',
      retryable: true,
      retryAfter: result.retryAfter,
      status: 429,
    });
  }
}

function credentialId(value: string): string {
  const separator = value.indexOf('.');
  const id = separator > 0 ? value.slice(0, separator) : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) {
    throw invalidAuthorization();
  }
  return id;
}

function normalizeRedirectUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError({
      code: 'invalid_request',
      message: 'Redirect URI is invalid.',
      status: 400,
    });
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new HttpError({
      code: 'invalid_request',
      message: 'Redirect URI is invalid.',
      status: 400,
    });
  }
  return url.toString();
}

function normalizeProviderError(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : 'access_denied';
}

function invalidAuthorization(): HttpError {
  return new HttpError({
    code: 'invalid_request',
    message: 'OIDC authorization is invalid or expired.',
    status: 400,
  });
}

function invalidExchange(): HttpError {
  return new HttpError({
    code: 'invalid_request',
    message: 'OIDC exchange code is invalid or expired.',
    status: 400,
  });
}
