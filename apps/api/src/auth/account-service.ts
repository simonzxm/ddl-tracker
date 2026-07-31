import {
  createUuidV7,
  parseDisplayName,
  parseUsername,
} from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';
import type { VerifiedOidcIdentity } from './oidc-provider-client.js';
import { createOpaqueSecret, hmacSha256 } from './primitives.js';

const SESSION_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const LAST_SEEN_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  status: 'active' | 'suspended' | 'deleted';
  profileRevision: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  deviceName: string | null;
  deviceMetadata: Record<string, unknown>;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthenticatedPrincipal {
  user: PublicUser;
  session: SessionRecord;
  roles: 'maintainer'[];
}

export interface AccountRepository {
  findUserByIdentity(issuer: string, subject: string): Promise<PublicUser | null>;
  findRoles(userId: string): Promise<'maintainer'[]>;
  createSession(input: SessionRecord): Promise<void>;
  updateIdentityLogin(input: {
    issuer: string;
    subject: string;
    userId: string;
    email: string | null;
    now: Date;
  }): Promise<void>;
  createOidcAccount(input: {
    user: PublicUser;
    identityId: string;
    identity: VerifiedOidcIdentity;
    session: SessionRecord;
    now: Date;
  }): Promise<'identity_exists' | 'username_taken' | 'success'>;
  findPrincipalBySessionHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthenticatedPrincipal | null>;
  touchSession(
    sessionId: string,
    now: Date,
    idleExpiresAt: Date,
  ): Promise<void>;
  listSessions(userId: string): Promise<SessionRecord[]>;
  revokeSession(userId: string, sessionId: string, now: Date): Promise<boolean>;
  revokeAllSessions(userId: string, now: Date): Promise<number>;
}

export interface SessionCompletion {
  kind: 'session';
  access_token: string;
  token_type: 'Bearer';
  expires_at: string;
  user: PublicUser;
  roles: 'maintainer'[];
}

export interface DeviceMetadataInput {
  deviceName: string | null;
  deviceMetadata: Record<string, unknown>;
}

export class AccountService {
  readonly #repository: AccountRepository;
  readonly #tokenPepper: string;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #createSecret: () => string;

  constructor(options: {
    repository: AccountRepository;
    tokenPepper: string;
    now?: () => Date;
    createId?: () => string;
    createSecret?: () => string;
  }) {
    this.#repository = options.repository;
    this.#tokenPepper = options.tokenPepper;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? createUuidV7;
    this.#createSecret = options.createSecret ?? createOpaqueSecret;
  }

  async signInWithOidc(
    identity: VerifiedOidcIdentity,
    device: DeviceMetadataInput,
  ): Promise<SessionCompletion> {
    for (const username of await this.#usernameCandidates(identity)) {
      const existingUser = await this.#repository.findUserByIdentity(
        identity.issuer,
        identity.subject,
      );
      if (existingUser !== null) {
        this.#assertActiveUser(existingUser);
        const issued = await this.#issueSession(existingUser.id, device);
        await this.#repository.updateIdentityLogin({
          issuer: identity.issuer,
          subject: identity.subject,
          userId: existingUser.id,
          email: identity.email,
          now: this.#now(),
        });
        return {
          kind: 'session',
          access_token: issued.token,
          token_type: 'Bearer',
          expires_at: issued.session.absoluteExpiresAt.toISOString(),
          user: existingUser,
          roles: await this.#repository.findRoles(existingUser.id),
        };
      }

      const now = this.#now();
      const user: PublicUser = {
        id: this.#createId(),
        username,
        displayName: this.#displayName(identity, username),
        avatarUrl: identity.avatarUrl,
        bio: null,
        status: 'active',
        profileRevision: 1,
      };
      const token = this.#createSecret();
      const session = await this.#buildSession(user.id, token, device, now);
      const outcome = await this.#repository.createOidcAccount({
        user,
        identityId: this.#createId(),
        identity,
        session,
        now,
      });
      if (outcome === 'identity_exists') continue;
      if (outcome === 'username_taken') continue;
      return {
        kind: 'session',
        access_token: token,
        token_type: 'Bearer',
        expires_at: session.absoluteExpiresAt.toISOString(),
        user,
        roles: [],
      };
    }

    throw new HttpError({
      code: 'internal_error',
      message: 'A unique account username could not be generated.',
      retryable: true,
      status: 500,
    });
  }

  async authenticate(token: string): Promise<AuthenticatedPrincipal> {
    const now = this.#now();
    const principal = await this.#repository.findPrincipalBySessionHash(
      await this.#hashToken(token),
      now,
    );
    if (principal === null) throw unauthenticated();
    this.#assertActiveUser(principal.user);
    const { session } = principal;
    if (
      session.revokedAt !== null ||
      session.idleExpiresAt.getTime() <= now.getTime() ||
      session.absoluteExpiresAt.getTime() <= now.getTime()
    ) {
      throw unauthenticated();
    }

    if (
      now.getTime() - session.lastSeenAt.getTime() >=
      LAST_SEEN_TOUCH_INTERVAL_MS
    ) {
      const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_TTL_MS);
      await this.#repository.touchSession(session.id, now, idleExpiresAt);
      session.lastSeenAt = now;
      session.idleExpiresAt = idleExpiresAt;
    }
    return principal;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return this.#repository.listSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    return this.#repository.revokeSession(userId, sessionId, this.#now());
  }

  async revokeAllSessions(userId: string): Promise<number> {
    return this.#repository.revokeAllSessions(userId, this.#now());
  }

  async #issueSession(
    userId: string,
    device: DeviceMetadataInput,
  ): Promise<{ token: string; session: SessionRecord }> {
    const now = this.#now();
    const token = this.#createSecret();
    const session = await this.#buildSession(userId, token, device, now);
    await this.#repository.createSession(session);
    return { token, session };
  }

  async #buildSession(
    userId: string,
    token: string,
    device: DeviceMetadataInput,
    now: Date,
  ): Promise<SessionRecord> {
    return {
      id: this.#createId(),
      userId,
      tokenHash: await this.#hashToken(token),
      deviceName: device.deviceName,
      deviceMetadata: device.deviceMetadata,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
      revokedAt: null,
    };
  }

  async #usernameCandidates(identity: VerifiedOidcIdentity): Promise<string[]> {
    const source =
      identity.email?.split('@')[0] ?? identity.displayName ?? identity.subject;
    let base = source
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '');
    if (base.length < 3) base = 'user';
    base = base.slice(0, 18).replace(/_+$/u, '') || 'user';
    const digest = (
      await hmacSha256(
        this.#tokenPepper,
        `${identity.issuer}\u0000${identity.subject}`,
      )
    )
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, '');
    return [
      `${base}_${digest.slice(0, 8)}`,
      `${base.slice(0, 14)}_${digest.slice(0, 12)}`,
      `user_${digest.slice(0, 20)}`,
    ].map((value) => parseUsername(value.slice(0, 32)));
  }

  #displayName(identity: VerifiedOidcIdentity, username: string): string {
    for (const candidate of [
      identity.displayName,
      identity.email?.split('@')[0] ?? null,
      username,
    ]) {
      if (candidate === null) continue;
      try {
        return parseDisplayName(candidate);
      } catch {
        // Try the next stable fallback.
      }
    }
    return username;
  }

  async #hashToken(token: string): Promise<string> {
    return hmacSha256(this.#tokenPepper, token);
  }

  #assertActiveUser(user: PublicUser): void {
    if (user.status === 'suspended') {
      throw new HttpError({
        code: 'account_suspended',
        message: 'Account is suspended.',
        status: 403,
      });
    }
    if (user.status !== 'active') throw unauthenticated();
  }
}

function unauthenticated(): HttpError {
  return new HttpError({
    code: 'unauthenticated',
    message: 'Authentication is required.',
    status: 401,
  });
}
