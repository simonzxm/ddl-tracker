import {
  createUuidV7,
  parseDisplayName,
  parseUsername,
} from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';
import {
  createOpaqueSecret,
  hmacSha256,
} from './primitives.js';
import type { VerifiedInstitutionalIdentity } from './email-challenge-service.js';

const REGISTRATION_TTL_MS = 15 * 60 * 1000;
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

export interface RegistrationIdentity {
  id: string;
  tokenHash: string;
  provider: 'email';
  normalizedSubject: string;
  subjectDisplay: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
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
  findUserByIdentity(
    provider: 'email',
    normalizedSubject: string,
  ): Promise<PublicUser | null>;
  findRoles(userId: string): Promise<'maintainer'[]>;
  saveRegistrationIdentity(input: RegistrationIdentity): Promise<void>;
  createSession(input: SessionRecord): Promise<void>;
  registerAccount(input: {
    registrationTokenHash: string;
    now: Date;
    user: PublicUser;
    identityId: string;
    session: SessionRecord;
  }): Promise<'invalid' | 'username_taken' | 'success'>;
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

export type VerificationCompletion =
  | {
      kind: 'registration';
      registration_token: string;
      expires_at: string;
    }
  | {
      kind: 'session';
      access_token: string;
      token_type: 'Bearer';
      expires_at: string;
      user: PublicUser;
      roles: 'maintainer'[];
    };

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

  async completeVerification(
    identity: VerifiedInstitutionalIdentity,
    device: DeviceMetadataInput,
  ): Promise<VerificationCompletion> {
    const existingUser = await this.#repository.findUserByIdentity(
      identity.provider,
      identity.normalizedSubject,
    );

    if (existingUser === null) {
      const now = this.#now();
      const token = this.#createSecret();
      const expiresAt = new Date(now.getTime() + REGISTRATION_TTL_MS);
      await this.#repository.saveRegistrationIdentity({
        id: this.#createId(),
        tokenHash: await this.#hashToken(token),
        provider: identity.provider,
        normalizedSubject: identity.normalizedSubject,
        subjectDisplay: identity.subjectDisplay,
        attempts: 0,
        expiresAt,
        createdAt: now,
      });
      return {
        kind: 'registration',
        registration_token: token,
        expires_at: expiresAt.toISOString(),
      };
    }

    this.#assertActiveUser(existingUser);
    const issued = await this.#issueSession(existingUser.id, device);
    const roles = await this.#repository.findRoles(existingUser.id);
    return {
      kind: 'session',
      access_token: issued.token,
      token_type: 'Bearer',
      expires_at: issued.session.absoluteExpiresAt.toISOString(),
      user: existingUser,
      roles,
    };
  }

  async register(input: {
    registrationToken: string;
    username: string;
    displayName: string | null;
    deviceName: string | null;
    deviceMetadata: Record<string, unknown>;
  }): Promise<{
    access_token: string;
    token_type: 'Bearer';
    expires_at: string;
    user: PublicUser;
  }> {
    let username: string;
    let displayName: string;
    try {
      username = parseUsername(input.username);
      displayName = parseDisplayName(input.displayName ?? username);
    } catch (error) {
      throw new HttpError({
        code: 'invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid account profile.',
        status: 400,
      });
    }

    const now = this.#now();
    const sessionToken = this.#createSecret();
    const user: PublicUser = {
      id: this.#createId(),
      username,
      displayName,
      avatarUrl: null,
      bio: null,
      status: 'active',
      profileRevision: 1,
    };
    const session = await this.#buildSession(
      user.id,
      sessionToken,
      {
        deviceName: input.deviceName,
        deviceMetadata: input.deviceMetadata,
      },
      now,
    );
    const outcome = await this.#repository.registerAccount({
      registrationTokenHash: await this.#hashToken(input.registrationToken),
      now,
      user,
      identityId: this.#createId(),
      session,
    });

    if (outcome === 'invalid') {
      throw new HttpError({
        code: 'registration_token_invalid',
        message: 'Registration token is invalid or expired.',
        status: 400,
      });
    }
    if (outcome === 'username_taken') {
      throw new HttpError({
        code: 'username_taken',
        message: 'Username is already in use.',
        status: 409,
      });
    }

    return {
      access_token: sessionToken,
      token_type: 'Bearer',
      expires_at: session.absoluteExpiresAt.toISOString(),
      user,
    };
  }

  async authenticate(token: string): Promise<AuthenticatedPrincipal> {
    const now = this.#now();
    const principal = await this.#repository.findPrincipalBySessionHash(
      await this.#hashToken(token),
      now,
    );
    if (principal === null) {
      throw new HttpError({
        code: 'unauthenticated',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    this.#assertActiveUser(principal.user);
    const { session } = principal;
    if (
      session.revokedAt !== null ||
      session.idleExpiresAt.getTime() <= now.getTime() ||
      session.absoluteExpiresAt.getTime() <= now.getTime()
    ) {
      throw new HttpError({
        code: 'unauthenticated',
        message: 'Authentication is required.',
        status: 401,
      });
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

  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
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
    if (user.status !== 'active') {
      throw new HttpError({
        code: 'unauthenticated',
        message: 'Authentication is required.',
        status: 401,
      });
    }
  }
}
