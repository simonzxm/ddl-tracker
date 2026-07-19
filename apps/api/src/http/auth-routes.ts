import {
  accountRegistrationRequestSchema,
  emailChallengeRequestSchema,
  emailVerificationRequestSchema,
  parseUuidV7,
  profileUpdateRequestSchema,
  type PublicUserWire,
} from '@ddl-tracker/contracts';
import type { Hono } from 'hono';

import type {
  AuthenticatedPrincipal,
  PublicUser,
  SessionRecord,
  VerificationCompletion,
} from '../auth/account-service.js';
import { HttpError } from './errors.js';
import type { AppVariables } from './app.js';
import { readValidatedJson } from './json-body.js';

const AUTH_BODY_LIMIT = 64 * 1024;

export interface AuthRouteDependencies {
  requestChallenge(email: string): Promise<{
    challenge_id: string;
    expires_at: string;
  }>;
  verifyChallenge(input: {
    challengeId: string;
    email: string;
    code: string;
    deviceName: string | null;
    deviceMetadata: Record<string, unknown>;
  }): Promise<VerificationCompletion>;
  registerAccount(input: {
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
  }>;
  authenticate(token: string): Promise<AuthenticatedPrincipal>;
  listSessions(userId: string): Promise<SessionRecord[]>;
  revokeSession(userId: string, sessionId: string): Promise<boolean>;
  revokeAllSessions(userId: string): Promise<number>;
  updateProfile(
    userId: string,
    input: {
      username: string;
      displayName: string;
      expectedRevision: number;
    },
  ): Promise<PublicUser>;
  deleteAccount(userId: string): Promise<void>;
}

function toPublicUser(user: PublicUser): PublicUserWire {
  return {
    id: user.id,
    username: user.username,
    display_name: user.displayName,
    status: user.status,
    profile_revision: user.profileRevision,
  };
}

function toSession(session: SessionRecord) {
  return {
    id: session.id,
    device_name: session.deviceName,
    device_metadata: session.deviceMetadata,
    created_at: session.createdAt.toISOString(),
    last_seen_at: session.lastSeenAt.toISOString(),
    idle_expires_at: session.idleExpiresAt.toISOString(),
    absolute_expires_at: session.absoluteExpiresAt.toISOString(),
    revoked_at: session.revokedAt?.toISOString() ?? null,
  };
}

function readBearerToken(authorization: string | undefined): string {
  if (authorization === undefined) {
    throw new HttpError({
      code: 'unauthenticated',
      message: 'Authentication is required.',
      status: 401,
    });
  }
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(authorization);
  if (match?.[1] === undefined) {
    throw new HttpError({
      code: 'unauthenticated',
      message: 'Authentication is required.',
      status: 401,
    });
  }
  return match[1];
}

async function authenticate(
  authorization: string | undefined,
  dependencies: AuthRouteDependencies,
): Promise<AuthenticatedPrincipal> {
  return dependencies.authenticate(readBearerToken(authorization));
}

export function registerAuthRoutes(
  app: Hono<{ Variables: AppVariables }>,
  dependencies: AuthRouteDependencies,
): void {
  app.post('/v1/auth/email/challenges', async (context) => {
    const body = await readValidatedJson(
      context.req.raw,
      emailChallengeRequestSchema,
      AUTH_BODY_LIMIT,
    );
    return context.json(await dependencies.requestChallenge(body.email));
  });

  app.post('/v1/auth/email/verifications', async (context) => {
    const body = await readValidatedJson(
      context.req.raw,
      emailVerificationRequestSchema,
      AUTH_BODY_LIMIT,
    );
    const result = await dependencies.verifyChallenge({
      challengeId: body.challenge_id,
      email: body.email,
      code: body.code,
      deviceName: body.device_name,
      deviceMetadata: body.device_metadata,
    });
    if (result.kind === 'registration') {
      return context.json(result);
    }
    return context.json({
      ...result,
      user: toPublicUser(result.user),
    });
  });

  app.post('/v1/accounts/registrations', async (context) => {
    const body = await readValidatedJson(
      context.req.raw,
      accountRegistrationRequestSchema,
      AUTH_BODY_LIMIT,
    );
    const result = await dependencies.registerAccount({
      registrationToken: body.registration_token,
      username: body.username,
      displayName: body.display_name,
      deviceName: body.device_name,
      deviceMetadata: body.device_metadata,
    });
    return context.json(
      {
        ...result,
        user: toPublicUser(result.user),
      },
      201,
    );
  });

  app.get('/v1/me', async (context) => {
    const principal = await authenticate(
      context.req.header('authorization'),
      dependencies,
    );
    return context.json(toPublicUser(principal.user));
  });

  app.patch('/v1/me/profile', async (context) => {
    const principal = await authenticate(
      context.req.header('authorization'),
      dependencies,
    );
    const body = await readValidatedJson(
      context.req.raw,
      profileUpdateRequestSchema,
      AUTH_BODY_LIMIT,
    );
    const updated = await dependencies.updateProfile(principal.user.id, {
      username: body.username,
      displayName: body.display_name,
      expectedRevision: body.expected_revision,
    });
    return context.json(toPublicUser(updated));
  });

  app.delete('/v1/me', async (context) => {
    const principal = await authenticate(
      context.req.header('authorization'),
      dependencies,
    );
    await dependencies.deleteAccount(principal.user.id);
    return context.body(null, 204);
  });

  app.get('/v1/sessions', async (context) => {
    const principal = await authenticate(
      context.req.header('authorization'),
      dependencies,
    );
    const sessions = await dependencies.listSessions(principal.user.id);
    return context.json({ sessions: sessions.map(toSession) });
  });

  app.delete('/v1/sessions/:session_id', async (context) => {
    const principal = await authenticate(
      context.req.header('authorization'),
      dependencies,
    );
    let sessionId: string;
    try {
      sessionId = parseUuidV7(context.req.param('session_id'));
    } catch {
      throw new HttpError({
        code: 'invalid_request',
        message: 'Session ID is invalid.',
        status: 400,
      });
    }
    const revoked = await dependencies.revokeSession(
      principal.user.id,
      sessionId,
    );
    if (!revoked) {
      throw new HttpError({
        code: 'not_found',
        message: 'Session not found.',
        status: 404,
      });
    }
    return context.body(null, 204);
  });

  app.delete('/v1/sessions', async (context) => {
    const principal = await authenticate(
      context.req.header('authorization'),
      dependencies,
    );
    await dependencies.revokeAllSessions(principal.user.id);
    return context.body(null, 204);
  });
}
