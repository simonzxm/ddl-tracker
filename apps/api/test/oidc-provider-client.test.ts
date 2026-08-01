import {
  SignJWT,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OidcProviderClient } from '../src/auth/oidc-provider-client.js';

const ISSUER = 'https://issuer.example';
const CLIENT_ID = 'ddl-tracker-client';
const REDIRECT_URI = 'https://ddl.nju.at/api/v1/auth/oidc/callback';

function discovery() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth2/authorize`,
    token_endpoint: `${ISSUER}/oauth2/token`,
    jwks_uri: `${ISSUER}/oauth2/jwks`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    id_token_signing_alg_values_supported: ['RS256'],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OidcProviderClient', () => {
  it('preserves the global fetch receiver when no fetcher is supplied', async () => {
    const fetcher = vi.fn(function (
      this: unknown,
      _input: string | URL | Request,
    ) {
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json(discovery()));
    });
    vi.stubGlobal('fetch', fetcher);
    const client = new OidcProviderClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
    });

    await expect(
      client.createAuthorizationUrl({
        state: 'state',
        nonce: 'nonce',
        codeChallenge: 'challenge',
      }),
    ).resolves.toContain('/oauth2/authorize');
  });

  it('discovers the provider and creates an authorization-code PKCE URL', async () => {
    const fetcher = vi.fn(async () => Response.json(discovery()));
    const client = new OidcProviderClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      fetcher,
    });

    const url = new URL(
      await client.createAuthorizationUrl({
        state: 'state',
        nonce: 'nonce',
        codeChallenge: 'challenge',
      }),
    );
    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth2/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid profile email',
      state: 'state',
      nonce: 'nonce',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    });
    expect(fetcher).toHaveBeenCalledWith(
      `${ISSUER}/.well-known/openid-configuration`,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('exchanges the code and verifies issuer, audience, signature and nonce', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const idToken = await new SignJWT({
      nonce: 'expected-nonce',
      email: 'student@example.edu',
      name: 'Student',
      picture: 'https://issuer.example/avatar.png',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('student-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json(discovery());
      }
      if (url.endsWith('/oauth2/token')) {
        expect(init?.method).toBe('POST');
        expect(String(init?.body)).toContain('code=provider-code');
        expect(String(init?.body)).toContain('code_verifier=verifier');
        expect(String(init?.body)).toContain(`client_id=${CLIENT_ID}`);
        return Response.json({ id_token: idToken, access_token: 'unused' });
      }
      if (url.endsWith('/oauth2/jwks')) {
        return Response.json({ keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('global fetch must not be used');
    }));
    const client = new OidcProviderClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      fetcher: fetcher as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: 'provider-code',
        codeVerifier: 'verifier',
        nonce: 'expected-nonce',
      }),
    ).resolves.toEqual({
      issuer: ISSUER,
      subject: 'student-123',
      email: 'student@example.edu',
      displayName: 'Student',
      avatarUrl: 'https://issuer.example/avatar.png',
    });
  });

  it('rejects a signed ID token with the wrong nonce', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const idToken = await new SignJWT({ nonce: 'wrong-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('student-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json(discovery());
      }
      if (url.endsWith('/oauth2/token')) return Response.json({ id_token: idToken });
      if (url.endsWith('/oauth2/jwks')) {
        return Response.json({ keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetcher);
    const client = new OidcProviderClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      fetcher: fetcher as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: 'provider-code',
        codeVerifier: 'verifier',
        nonce: 'expected-nonce',
      }),
    ).rejects.toThrow('OIDC ID token claims are invalid.');
  });
});
