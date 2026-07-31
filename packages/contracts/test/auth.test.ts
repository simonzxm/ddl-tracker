import { describe, expect, it } from 'vitest';

import {
  oidcAuthorizationRequestSchema,
  oidcAuthorizationResponseSchema,
  oidcExchangeRequestSchema,
  profileUpdateRequestSchema,
  sessionVerificationResponseSchema,
} from '../src/auth.js';

const ID = '018f0000-0000-7000-8000-000000000001';

function user() {
  return {
    id: ID,
    username: 'student_123',
    display_name: 'Student',
    avatar_url: null,
    bio: null,
    status: 'active' as const,
    profile_revision: 1,
    roles: [] as const,
  };
}

describe('authentication contracts', () => {
  it('accepts only absolute post-login redirect URIs without credentials', () => {
    expect(
      oidcAuthorizationRequestSchema.parse({
        redirect_uri: 'https://app.example/auth/callback',
      }),
    ).toEqual({ redirect_uri: 'https://app.example/auth/callback' });
    expect(() =>
      oidcAuthorizationRequestSchema.parse({ redirect_uri: '/callback' }),
    ).toThrow();
    expect(() =>
      oidcAuthorizationRequestSchema.parse({
        redirect_uri: 'https://user:pass@app.example/callback',
      }),
    ).toThrow();
  });

  it('validates authorization start and one-time exchange payloads', () => {
    expect(
      oidcAuthorizationResponseSchema.parse({
        authorization_url: 'https://issuer.example/oauth2/authorize',
        expires_at: '2026-07-30T12:00:00.000Z',
      }),
    ).toMatchObject({ authorization_url: expect.any(String) });
    expect(
      oidcExchangeRequestSchema.parse({
        code: 'one-time-code',
        device_name: 'MacBook',
        device_metadata: { platform: 'macos' },
      }),
    ).toEqual({
      code: 'one-time-code',
      device_name: 'MacBook',
      device_metadata: { platform: 'macos' },
    });
    expect(() =>
      oidcExchangeRequestSchema.parse({ code: '', unexpected: true }),
    ).toThrow();
  });

  it('validates a local session response after OIDC exchange', () => {
    expect(
      sessionVerificationResponseSchema.parse({
        kind: 'session',
        access_token: 'opaque-token',
        token_type: 'Bearer',
        expires_at: '2027-01-28T12:00:00.000Z',
        user: user(),
      }),
    ).toMatchObject({ kind: 'session', user: { username: 'student_123' } });
  });

  it('keeps optimistic profile update validation unchanged', () => {
    expect(
      profileUpdateRequestSchema.parse({
        username: 'new_name',
        display_name: 'New Name',
        avatar_url: null,
        bio: null,
        expected_revision: 2,
      }),
    ).toMatchObject({ expected_revision: 2 });
  });
});
