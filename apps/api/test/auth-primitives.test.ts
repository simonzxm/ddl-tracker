import { describe, expect, it } from 'vitest';

import {
  createOpaqueSecret,
  openJson,
  sealJson,
  sha256,
} from '../src/auth/primitives.js';

describe('authentication primitives', () => {
  it('creates a URL-safe 256-bit opaque secret', () => {
    const secret = createOpaqueSecret((length) => new Uint8Array(length).fill(7));
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(secret).toHaveLength(43);
  });

  it('computes the PKCE SHA-256 challenge deterministically', async () => {
    await expect(sha256('verifier')).resolves.toBe(
      'iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ',
    );
  });

  it('encrypts and authenticates short-lived transaction secrets', async () => {
    const sealed = await sealJson(
      'x'.repeat(64),
      { nonce: 'nonce', verifier: 'verifier' },
      (length) => new Uint8Array(length).fill(3),
    );
    expect(sealed).not.toContain('nonce');
    await expect(openJson('x'.repeat(64), sealed)).resolves.toEqual({
      nonce: 'nonce',
      verifier: 'verifier',
    });
    await expect(openJson('y'.repeat(64), sealed)).rejects.toThrow();
  });
});
