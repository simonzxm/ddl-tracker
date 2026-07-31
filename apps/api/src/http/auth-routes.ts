import {
  oidcAuthorizationRequestSchema,
  oidcExchangeRequestSchema,
  parseUuidV7,
  profileUpdateRequestSchema,
  type CurrentUserWire,
  type PublicUserWire,
} from '@ddl-tracker/contracts';
import type { Hono } from 'hono';

import type {
  AuthenticatedPrincipal,
  PublicUser,
  SessionCompletion,
  SessionRecord,
} from '../auth/account-service.js';
import type { OidcCallbackResult } from '../auth/oidc-login-service.js';
import { authenticateBearer } from './bearer.js';
import { HttpError } from './errors.js';
import type { AppVariables } from './app.js';
import { readValidatedJson } from './json-body.js';

const AUTH_BODY_LIMIT = 64 * 1024;

export interface AuthRouteDependencies {
  beginOidcAuthorization(input: {
    redirectUri: string;
    sourceIp: string;
  }): Promise<{ authorization_url: string; expires_at: string }>;
  completeOidcAuthorization(input: {
    state: string | null;
    code: string | null;
    providerError: string | null;
  }): Promise<OidcCallbackResult>;
  exchangeOidcAuthorization(input: {
    code: string;
    deviceName: string | null;
    deviceMetadata: Record<string, unknown>;
  }): Promise<SessionCompletion>;
  authenticate(token: string): Promise<AuthenticatedPrincipal>;
  rateLimit(userId: string): Promise<void>;
  listSessions(userId: string): Promise<SessionRecord[]>;
  revokeSession(userId: string, sessionId: string): Promise<boolean>;
  revokeAllSessions(userId: string): Promise<number>;
  updateProfile(
    userId: string,
    input: {
      username: string;
      displayName: string;
      avatarUrl: string | null;
      bio: string | null;
      expectedRevision: number;
    },
  ): Promise<PublicUser>;
  deleteAccount(userId: string): Promise<void>;
}

async function requirePrincipal(
  authorization: string | undefined,
  dependencies: AuthRouteDependencies,
): Promise<AuthenticatedPrincipal> {
  const principal = await authenticateBearer(authorization, (token) =>
    dependencies.authenticate(token),
  );
  await dependencies.rateLimit(principal.user.id);
  return principal;
}

function toPublicUser(user: PublicUser): PublicUserWire {
  return {
    id: user.id,
    username: user.username,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    bio: user.bio,
    status: user.status,
    profile_revision: user.profileRevision,
  };
}

function toCurrentUser(
  user: PublicUser,
  roles: 'maintainer'[],
): CurrentUserWire {
  return { ...toPublicUser(user), roles };
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

export function registerAuthRoutes(
  app: Hono<{ Variables: AppVariables }>,
  dependencies: AuthRouteDependencies,
): void {
  app.post('/v1/auth/oidc/start', async (context) => {
    const body = await readValidatedJson(
      context.req.raw,
      oidcAuthorizationRequestSchema,
      AUTH_BODY_LIMIT,
    );
    return context.json(
      await dependencies.beginOidcAuthorization({
        redirectUri: body.redirect_uri,
        sourceIp: normalizedConnectingIp(
          context.req.header('cf-connecting-ip'),
        ),
      }),
    );
  });

  app.get('/v1/auth/oidc/callback', async (context) => {
    const result = await dependencies.completeOidcAuthorization({
      state: context.req.query('state') ?? null,
      code: context.req.query('code') ?? null,
      providerError: context.req.query('error') ?? null,
    });
    const redirect = new URL(result.redirectUri);
    if (result.kind === 'success') {
      redirect.searchParams.set('code', result.exchangeCode);
    } else {
      redirect.searchParams.set('error', result.error);
    }
    return context.redirect(redirect.toString(), 302);
  });

  app.post('/v1/auth/oidc/exchange', async (context) => {
    const body = await readValidatedJson(
      context.req.raw,
      oidcExchangeRequestSchema,
      AUTH_BODY_LIMIT,
    );
    const result = await dependencies.exchangeOidcAuthorization({
      code: body.code,
      deviceName: body.device_name,
      deviceMetadata: body.device_metadata,
    });
    return context.json({
      ...result,
      user: toCurrentUser(result.user, result.roles),
    });
  });

  app.get('/v1/me', async (context) => {
    const principal = await requirePrincipal(
      context.req.header('authorization'),
      dependencies,
    );
    return context.json(toCurrentUser(principal.user, principal.roles));
  });

  app.patch('/v1/me/profile', async (context) => {
    const principal = await requirePrincipal(
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
      avatarUrl: body.avatar_url,
      bio: body.bio,
      expectedRevision: body.expected_revision,
    });
    return context.json(toCurrentUser(updated, principal.roles));
  });

  app.delete('/v1/me', async (context) => {
    const principal = await requirePrincipal(
      context.req.header('authorization'),
      dependencies,
    );
    await dependencies.deleteAccount(principal.user.id);
    return context.body(null, 204);
  });

  app.get('/v1/sessions', async (context) => {
    const principal = await requirePrincipal(
      context.req.header('authorization'),
      dependencies,
    );
    const sessions = await dependencies.listSessions(principal.user.id);
    return context.json({ sessions: sessions.map(toSession) });
  });

  app.delete('/v1/sessions/:session_id', async (context) => {
    const principal = await requirePrincipal(
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
    const principal = await requirePrincipal(
      context.req.header('authorization'),
      dependencies,
    );
    await dependencies.revokeAllSessions(principal.user.id);
    return context.body(null, 204);
  });
}

function normalizedConnectingIp(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === undefined ||
    normalized.length === 0 ||
    normalized.length > 64 ||
    !/^[0-9a-f:.]+$/u.test(normalized)
  ) {
    return 'unavailable';
  }
  return normalized;
}
