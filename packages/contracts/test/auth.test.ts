import { describe, expect, it } from 'vitest';

import {
  accountRegistrationRequestSchema,
  emailChallengeRequestSchema,
  emailVerificationRequestSchema,
  currentUserSchema,
  profileUpdateRequestSchema,
  verificationResponseSchema,
} from '../src/auth.js';

const ID = '018f0000-0000-7000-8000-000000000001';

describe('authentication contracts', () => {
  it('validates email challenge requests without extra fields', () => {
    expect(
      emailChallengeRequestSchema.parse({ email: 'student@example.edu' }),
    ).toEqual({ email: 'student@example.edu' });
    expect(() =>
      emailChallengeRequestSchema.parse({
        email: 'student@example.edu',
        user_id: ID,
      }),
    ).toThrow();
  });

  it('requires a six digit code and device metadata object', () => {
    expect(
      emailVerificationRequestSchema.parse({
        challenge_id: ID,
        email: 'student@example.edu',
        code: '123456',
        device_name: 'MacBook',
        device_metadata: { platform: 'macOS' },
      }),
    ).toMatchObject({ code: '123456' });
    expect(() =>
      emailVerificationRequestSchema.parse({
        challenge_id: ID,
        email: 'student@example.edu',
        code: '12345',
        device_metadata: {},
      }),
    ).toThrow();
  });

  it('validates registration profile and token', () => {
    expect(
      accountRegistrationRequestSchema.parse({
        registration_token: 'opaque-token',
        username: 'student_1',
        display_name: 'Student',
        device_name: null,
        device_metadata: {},
      }),
    ).toMatchObject({ username: 'student_1' });
  });

  it('validates current-user capabilities and editable profile fields', () => {
    expect(
      currentUserSchema.parse({
        id: ID,
        username: 'student',
        display_name: 'Student',
        avatar_url: 'HTTPS://Example.COM/avatar.png#crop',
        bio: '  Course representative  ',
        status: 'active',
        profile_revision: 1,
        roles: ['maintainer'],
      }),
    ).toMatchObject({
      avatar_url: 'https://example.com/avatar.png',
      bio: 'Course representative',
      roles: ['maintainer'],
    });

    expect(
      profileUpdateRequestSchema.parse({
        username: 'student',
        display_name: 'Student',
        avatar_url: null,
        bio: null,
        expected_revision: 1,
      }),
    ).toMatchObject({ avatar_url: null, bio: null });
  });

  it('distinguishes registration and session verification responses', () => {
    expect(
      verificationResponseSchema.parse({
        kind: 'registration',
        registration_token: 'opaque-token',
        expires_at: '2026-07-19T12:15:00.000Z',
      }),
    ).toMatchObject({ kind: 'registration' });
    expect(
      verificationResponseSchema.parse({
        kind: 'session',
        access_token: 'opaque-token',
        token_type: 'Bearer',
        expires_at: '2027-01-15T12:00:00.000Z',
        user: {
          id: ID,
          username: 'student',
          display_name: 'Student',
          avatar_url: null,
          bio: null,
          status: 'active',
          profile_revision: 1,
          roles: [],
        },
      }),
    ).toMatchObject({ kind: 'session' });
  });
});
