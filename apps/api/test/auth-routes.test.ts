import { describe, expect, it, vi } from 'vitest';

import type {
  AuthenticatedPrincipal,
  PublicUser,
  SessionRecord,
} from '../src/auth/account-service.js';
import { createApp } from '../src/http/app.js';
import type { AuthRouteDependencies } from '../src/http/auth-routes.js';
import { HttpError } from '../src/http/errors.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000000001';
const USER_ID = '018f0000-0000-7000-8000-000000000002';
const SESSION_ID = '018f0000-0000-7000-8000-000000000003';

const user: PublicUser = {
  id: USER_ID,
  username: 'student',
  displayName: 'Student',
  status: 'active',
  profileRevision: 1,
};

const session: SessionRecord = {
  id: SESSION_ID,
  userId: USER_ID,
  tokenHash: 'private',
  deviceName: 'MacBook',
  deviceMetadata: {},
  createdAt: new Date('2026-07-19T12:00:00.000Z'),
  lastSeenAt: new Date('2026-07-19T12:00:00.000Z'),
  idleExpiresAt: new Date('2026-08-18T12:00:00.000Z'),
  absoluteExpiresAt: new Date('2027-01-15T12:00:00.000Z'),
  revokedAt: null,
};

function dependencies(): AuthRouteDependencies {
  const principal: AuthenticatedPrincipal = { user, session, roles: [] };
  return {
    requestChallenge: vi.fn(async () => ({
      challenge_id: REQUEST_ID,
      expires_at: '2026-07-19T12:10:00.000Z',
    })),
    verifyChallenge: vi.fn(async () => ({
      kind: 'registration' as const,
      registration_token: 'registration-token',
      expires_at: '2026-07-19T12:15:00.000Z',
    })),
    registerAccount: vi.fn(async () => ({
      access_token: 'session-token',
      token_type: 'Bearer' as const,
      expires_at: '2027-01-15T12:00:00.000Z',
      user,
    })),
    authenticate: vi.fn(async (token) => {
      if (token !== 'session-token') {
        throw new Error('unexpected token');
      }
      return principal;
    }),
    rateLimit: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => [session]),
    revokeSession: vi.fn(async () => true),
    revokeAllSessions: vi.fn(async () => 1),
    updateProfile: vi.fn(async () => ({
      ...user,
      username: 'new_name',
      displayName: 'New Name',
      profileRevision: 2,
    })),
    deleteAccount: vi.fn(async () => undefined),
  };
}

function app(auth: AuthRouteDependencies) {
  return createApp({
    createRequestId: () => REQUEST_ID,
    checkReady: async () => true,
    auth,
  });
}

describe('authentication routes', () => {
  it('validates and requests an email challenge', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/v1/auth/email/challenges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'student@example.edu' }),
    });

    expect(response.status).toBe(200);
    expect(auth.requestChallenge).toHaveBeenCalledWith('student@example.edu');
  });

  it('verifies a challenge with device metadata', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/v1/auth/email/verifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challenge_id: REQUEST_ID,
        email: 'student@example.edu',
        code: '123456',
        device_name: 'MacBook',
        device_metadata: { platform: 'macOS' },
      }),
    });

    expect(response.status).toBe(200);
    expect(auth.verifyChallenge).toHaveBeenCalledWith({
      challengeId: REQUEST_ID,
      email: 'student@example.edu',
      code: '123456',
      deviceName: 'MacBook',
      deviceMetadata: { platform: 'macOS' },
    });
  });

  it('registers an account and maps the public user to snake case', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/v1/accounts/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        registration_token: 'registration-token',
        username: 'student',
        display_name: 'Student',
        device_name: null,
        device_metadata: {},
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      user: {
        id: USER_ID,
        username: 'student',
        display_name: 'Student',
        profile_revision: 1,
      },
    });
  });

  it('requires a bearer token for protected account routes', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/v1/me');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'unauthenticated',
      request_id: REQUEST_ID,
    });
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('stops protected account work when the read allowance is exhausted', async () => {
    const auth = dependencies();
    auth.rateLimit = vi.fn(async () => {
      throw new HttpError({
        code: 'rate_limited',
        message: 'Too many requests.',
        retryable: true,
        retryAfter: 8,
        status: 429,
      });
    });
    const response = await app(auth).request('/v1/sessions', {
      headers: { authorization: 'Bearer session-token' },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('8');
    expect(auth.listSessions).not.toHaveBeenCalled();
  });

  it('returns the current user and never exposes token hashes', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/v1/me', {
      headers: { authorization: 'Bearer session-token' },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('private');
    expect(JSON.parse(body)).toMatchObject({
      id: USER_ID,
      display_name: 'Student',
    });
  });

  it('updates only the authenticated user profile with expected revision', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/v1/me/profile', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'new_name',
        display_name: 'New Name',
        expected_revision: 1,
      }),
    });

    expect(response.status).toBe(200);
    expect(auth.updateProfile).toHaveBeenCalledWith(USER_ID, {
      username: 'new_name',
      displayName: 'New Name',
      expectedRevision: 1,
    });
    await expect(response.json()).resolves.toMatchObject({
      username: 'new_name',
      display_name: 'New Name',
      profile_revision: 2,
    });
  });

  it('deletes only the authenticated account', async () => {
    const auth = dependencies();
    const response = await app(auth).request('/v1/me', {
      method: 'DELETE',
      headers: { authorization: 'Bearer session-token' },
    });

    expect(response.status).toBe(204);
    expect(auth.deleteAccount).toHaveBeenCalledWith(USER_ID);
  });

  it('lists and revokes only the authenticated user sessions', async () => {
    const auth = dependencies();
    const headers = { authorization: 'Bearer session-token' };

    const list = await app(auth).request('/v1/sessions', { headers });
    expect(list.status).toBe(200);
    expect(auth.listSessions).toHaveBeenCalledWith(USER_ID);

    const revoke = await app(auth).request(`/v1/sessions/${SESSION_ID}`, {
      method: 'DELETE',
      headers,
    });
    expect(revoke.status).toBe(204);
    expect(auth.revokeSession).toHaveBeenCalledWith(USER_ID, SESSION_ID);
  });
});
