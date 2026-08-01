import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { z } from 'zod';

export interface VerifiedOidcIdentity {
  issuer: string;
  subject: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OidcProvider {
  createAuthorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string>;
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<VerifiedOidcIdentity>;
}

const discoveryDocumentSchema = z
  .object({
    issuer: z.string().trim().min(1),
    authorization_endpoint: z.string().trim().min(1),
    token_endpoint: z.string().trim().min(1),
    jwks_uri: z.string().trim().min(1),
    response_types_supported: z.array(z.string()),
    code_challenge_methods_supported: z.array(z.string()),
    id_token_signing_alg_values_supported: z.array(z.string()),
  })
  .passthrough();

const tokenResponseSchema = z
  .object({ id_token: z.string().min(1) })
  .passthrough();

type DiscoveryDocument = z.infer<typeof discoveryDocumentSchema>;

export class OidcProviderClient implements OidcProvider {
  readonly #issuer: string;
  readonly #clientId: string;
  readonly #redirectUri: string;
  readonly #fetch: typeof fetch;
  #discovery: Promise<DiscoveryDocument> | null = null;
  #jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(options: {
    issuer: string;
    clientId: string;
    redirectUri: string;
    fetcher?: typeof fetch;
  }) {
    this.#issuer = normalizeIssuer(options.issuer);
    this.#clientId = requiredValue('OIDC client ID', options.clientId);
    this.#redirectUri = requireHttpsUrl('OIDC redirect URI', options.redirectUri);
    this.#fetch =
      options.fetcher ??
      ((input, init) => globalThis.fetch(input, init));
  }

  async createAuthorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string> {
    const metadata = await this.#discover();
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set('client_id', this.#clientId);
    url.searchParams.set('redirect_uri', this.#redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<VerifiedOidcIdentity> {
    const metadata = await this.#discover();
    const response = await this.#fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.#clientId,
        redirect_uri: this.#redirectUri,
        code: input.code,
        code_verifier: input.codeVerifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = tokenResponseSchema.safeParse(await readJson(response));
    if (!response.ok || !body.success) {
      throw new Error('OIDC token exchange failed.');
    }

    this.#jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri), {
      [customFetch]: (url, init) => this.#fetch(url, init),
    });
    const verified = await jwtVerify(body.data.id_token, this.#jwks, {
      issuer: this.#issuer,
      audience: this.#clientId,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      clockTolerance: 30,
    });
    const claims = verified.payload;
    if (claims.nonce !== input.nonce || typeof claims.sub !== 'string' || claims.sub === '') {
      throw new Error('OIDC ID token claims are invalid.');
    }
    if (typeof claims.azp === 'string' && claims.azp !== this.#clientId) {
      throw new Error('OIDC authorized party is invalid.');
    }

    return {
      issuer: this.#issuer,
      subject: claims.sub,
      email: optionalString(claims.email),
      displayName: optionalString(claims.name),
      avatarUrl: validPicture(optionalString(claims.picture)),
    };
  }

  async #discover(): Promise<DiscoveryDocument> {
    this.#discovery ??= this.#fetchDiscovery();
    return this.#discovery;
  }

  async #fetchDiscovery(): Promise<DiscoveryDocument> {
    const url = `${this.#issuer}/.well-known/openid-configuration`;
    const response = await this.#fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = discoveryDocumentSchema.safeParse(await readJson(response));
    if (!response.ok || !parsed.success) {
      throw new Error('OIDC discovery failed.');
    }
    const metadata: DiscoveryDocument = parsed.data;
    if (normalizeIssuer(metadata.issuer) !== this.#issuer) {
      throw new Error('OIDC discovery issuer mismatch.');
    }
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.jwks_uri,
    ]) requireHttpsUrl('OIDC endpoint', endpoint);
    if (!metadata.response_types_supported.includes('code')) {
      throw new Error('OIDC provider does not support authorization code flow.');
    }
    if (!metadata.code_challenge_methods_supported.includes('S256')) {
      throw new Error('OIDC provider does not support PKCE S256.');
    }
    if (!metadata.id_token_signing_alg_values_supported.includes('RS256')) {
      throw new Error('OIDC provider does not support RS256 ID tokens.');
    }
    return metadata;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json<unknown>();
  } catch {
    return null;
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function validPicture(value: string | null): string | null {
  if (value === null || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeIssuer(value: string): string {
  const url = new URL(requiredValue('OIDC issuer', value));
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('OIDC issuer must be an HTTPS URL without credentials.');
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString().replace(/\/$/u, '');
}

function requireHttpsUrl(name: string, value: string): string {
  const url = new URL(requiredValue(name, value));
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error(`${name} must be an HTTPS URL without credentials.`);
  }
  return url.toString();
}

function requiredValue(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new Error(`${name} is required.`);
  return normalized;
}
