import { describe, expect, it, vi } from 'vitest';

import type {
  AuthenticatedPrincipal,
  PublicUser,
  SessionRecord,
} from '../src/auth/account-service.js';
import { createApp } from '../src/http/app.js';
import type { AuthRouteDependencies } from '../src/http/auth-routes.js';
import { HttpError } from '../src/http/errors.js';

const USER_ID = '018f0000-0000-7000-8000-000000000001';
const SESSION_ID = '018f0000-0000-7000-8000-000000000003';
const NOW = new Date('2026-07-30T12:00:00.000Z');
const user: PublicUser = {
  id: USER_ID,
  username: 'student_123',
  displayName: 'Student',
  avatarUrl: null,
  bio: null,
  status: 'active',
  profileRevision: 1,
};
const session: SessionRecord = {
  id: SESSION_ID,
  userId: USER_ID,
  tokenHash: 'hash',
  deviceName: 'MacBook',
  deviceMetadata: { platform: 'macos' },
  createdAt: NOW,
  lastSeenAt: NOW,
  idleExpiresAt: new Date('2026-08-29T12:00:00.000Z'),
  absoluteExpiresAt: new Date('2027-01-26T12:00:00.000Z'),
  revokedAt: null,
};

function dependencies(): AuthRouteDependencies {
  const principal: AuthenticatedPrincipal = { user, session, roles: [] };
  return {
    beginOidcAuthorization: vi.fn(async () => ({
      authorization_url: 'https://issuer.example/oauth2/authorize?state=opaque',
      expires_at: '2026-07-30T12:10:00.000Z',
    })),
    completeOidcAuthorization: vi.fn(async () => ({
      kind: 'success' as const,
      redirectUri: 'https://app.example/auth/callback',
      exchangeCode: 'one-time-code',
    })),
    exchangeOidcAuthorization: vi.fn(async () => ({
      kind: 'session' as const,
      access_token: 'session-token',
      token_type: 'Bearer' as const,
      expires_at: '2027-01-26T12:00:00.000Z',
      user,
      roles: [] as 'maintainer'[],
    })),
    authenticate: vi.fn(async (token) => {
      if (token !== 'session-token') {
        throw new HttpError({
          code: 'unauthenticated',
          message: 'Authentication is required.',
          status: 401,
        });
      }
      return principal;
    }),
    rateLimit: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => [session]),
    revokeSession: vi.fn(async () => true),
    revokeAllSessions: vi.fn(async () => 1),
    updateProfile: vi.fn(async (_userId, input) => ({
      ...user,
      username: input.username,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      bio: input.bio,
      profileRevision: input.expectedRevision + 1,
    })),
    deleteAccount: vi.fn(async () => undefined),
  };
}

function app(auth: AuthRouteDependencies) {
  return createApp({ checkReady: async () => true, auth });
}

describe('OIDC authentication routes', () => {
  it('starts authorization with a validated redirect and normalized source IP', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/api/v1/auth/oidc/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '2001:DB8::1',
      },
      body: JSON.stringify({
        redirect_uri: 'https://app.example/auth/callback',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authorization_url: expect.stringContaining('/oauth2/authorize'),
    });
    expect(auth.beginOidcAuthorization).toHaveBeenCalledWith({
      redirectUri: 'https://app.example/auth/callback',
      sourceIp: '2001:db8::1',
    });
  });

  it('rejects malformed authorization and exchange payloads before dependencies', async () => {
    const auth = dependencies();
    const start = await app(auth).request('/api/v1/auth/oidc/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uri: '/relative' }),
    });
    const exchange = await app(auth).request('/api/v1/auth/oidc/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '', extra: true }),
    });
    expect(start.status).toBe(400);
    expect(exchange.status).toBe(400);
    expect(auth.beginOidcAuthorization).not.toHaveBeenCalled();
    expect(auth.exchangeOidcAuthorization).not.toHaveBeenCalled();
  });

  it('passes the provider callback and redirects with only the one-time code', async () => {
    const auth = dependencies();
    const response = await app(auth).request(
      '/api/v1/auth/oidc/callback?state=state-value&code=provider-code',
      { redirect: 'manual' },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://app.example/auth/callback?code=one-time-code',
    );
    expect(auth.completeOidcAuthorization).toHaveBeenCalledWith({
      state: 'state-value',
      code: 'provider-code',
      providerError: null,
    });
  });

  it('redirects provider failures without exposing a local session token', async () => {
    const auth = dependencies();
    auth.completeOidcAuthorization = vi.fn(async () => ({
      kind: 'error' as const,
      redirectUri: 'https://app.example/auth/callback',
      error: 'access_denied',
    }));
    const response = await app(auth).request(
      '/api/v1/auth/oidc/callback?state=state&error=access_denied',
      { redirect: 'manual' },
    );
    expect(response.headers.get('location')).toBe(
      'https://app.example/auth/callback?error=access_denied',
    );
  });

  it('exchanges a one-time code for the existing local session wire format', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/api/v1/auth/oidc/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'one-time-code',
        device_name: 'MacBook',
        device_metadata: { platform: 'macos' },
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: 'session',
      access_token: 'session-token',
      token_type: 'Bearer',
      user: { id: USER_ID, roles: [] },
    });
    expect(auth.exchangeOidcAuthorization).toHaveBeenCalledWith({
      code: 'one-time-code',
      deviceName: 'MacBook',
      deviceMetadata: { platform: 'macos' },
    });
  });
});

describe('authenticated account routes', () => {
  it('requires a Bearer session before reading the current user', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/api/v1/me');
    expect(response.status).toBe(401);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('returns and updates only the authenticated user profile', async () => {
    const auth = dependencies();
    const headers = { authorization: 'Bearer session-token' };
    const current = await app(auth).request('/api/v1/me', { headers });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({ id: USER_ID, roles: [] });

    const updated = await app(auth).request('/api/v1/me/profile', {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'new_name',
        display_name: 'New Name',
        avatar_url: null,
        bio: null,
        expected_revision: 1,
      }),
    });
    expect(updated.status).toBe(200);
    expect(auth.updateProfile).toHaveBeenCalledWith(USER_ID, {
      username: 'new_name',
      displayName: 'New Name',
      avatarUrl: null,
      bio: null,
      expectedRevision: 1,
    });
  });

  it('lists and revokes only the authenticated account sessions', async () => {
    const auth = dependencies();
    const headers = { authorization: 'Bearer session-token' };
    const listed = await app(auth).request('/api/v1/sessions', { headers });
    expect(listed.status).toBe(200);
    expect(auth.listSessions).toHaveBeenCalledWith(USER_ID);

    const revoked = await app(auth).request(`/api/v1/sessions/${SESSION_ID}`, {
      method: 'DELETE',
      headers,
    });
    expect(revoked.status).toBe(204);
    expect(auth.revokeSession).toHaveBeenCalledWith(USER_ID, SESSION_ID);
  });
});
