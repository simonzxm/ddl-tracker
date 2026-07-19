import { describe, expect, it } from 'vitest';

import {
  constantTimeEqual,
  createNumericCode,
  createOpaqueSecret,
  hmacSha256,
  normalizeInstitutionalEmail,
} from '../src/auth/primitives.js';

describe('authentication primitives', () => {
  it('normalizes institutional email deterministically', () => {
    expect(
      normalizeInstitutionalEmail('  Student@EXAMPLE.EDU  ', ['example.edu']),
    ).toEqual({
      normalized: 'student@example.edu',
      display: 'Student@EXAMPLE.EDU',
    });
  });

  it('rejects malformed and disallowed email domains identically', () => {
    for (const value of ['not-an-email', 'student@other.edu']) {
      expect(() =>
        normalizeInstitutionalEmail(value, ['example.edu']),
      ).toThrow('institutional email');
    }
  });

  it('creates exactly six numeric digits from secure bytes', () => {
    expect(createNumericCode(() => new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe(
      '012345',
    );
  });

  it('creates 256-bit opaque secrets in base64url form', () => {
    const token = createOpaqueSecret(() => new Uint8Array(32).fill(255));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('computes stable HMAC values and compares them in constant time shape', async () => {
    const first = await hmacSha256('secret', 'payload');
    const second = await hmacSha256('secret', 'payload');
    const third = await hmacSha256('secret', 'other');

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(constantTimeEqual(first, second)).toBe(true);
    expect(constantTimeEqual(first, third)).toBe(false);
    expect(constantTimeEqual(first, `${first}x`)).toBe(false);
  });
});
