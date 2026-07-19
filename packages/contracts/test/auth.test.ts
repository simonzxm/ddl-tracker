import { describe, expect, it } from 'vitest';

import {
  accountRegistrationRequestSchema,
  emailChallengeRequestSchema,
  emailVerificationRequestSchema,
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
          status: 'active',
          profile_revision: 1,
        },
      }),
    ).toMatchObject({ kind: 'session' });
  });
});
