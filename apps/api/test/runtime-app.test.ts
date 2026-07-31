import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { OidcProvider } from '../src/auth/oidc-provider-client.js';
import { latestMigrationHash } from '../src/db/latest-migration.js';
import { createRuntimeApp } from '../src/runtime-app.js';

function environment(overrides: Partial<Env> = {}): Env {
  return {
    HYPERDRIVE: {
      connectionString: 'postgresql://hyperdrive.invalid/database',
    } as Hyperdrive,
    APP_ENVIRONMENT: 'development',
    OIDC_ISSUER: 'https://issuer.example',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_REDIRECT_URI: 'https://api.example/api/v1/auth/oidc/callback',
    OIDC_POST_LOGIN_REDIRECT_URIS: 'https://app.example/auth/callback',
    OIDC_TRANSACTION_SECRET: 'o'.repeat(64),
    TOKEN_PEPPER: 'p'.repeat(64),
    SYNC_TOKEN_SECRET: 's'.repeat(64),
    MAINTAINER_BOOTSTRAP_TOKEN: 'b'.repeat(64),
    ...overrides,
  };
}

function client() {
  return {
    query: vi.fn(async () => ({
      rows: [{ applied: true }],
      rowCount: 1,
    })),
  } as unknown as Client;
}

const oidcProvider: OidcProvider = {
  createAuthorizationUrl: vi.fn(async () => 'https://issuer.example/authorize'),
  exchangeAuthorizationCode: vi.fn(async () => ({
    issuer: 'https://issuer.example',
    subject: 'student',
    email: null,
    displayName: null,
    avatarUrl: null,
  })),
};

describe('createRuntimeApp', () => {
  it('serves liveness without querying PostgreSQL and readiness with the same client', async () => {
    const database = client();
    const app = createRuntimeApp(database, environment(), { oidcProvider });

    const live = await app.request('/api/health/live');
    expect(live.status).toBe(200);
    expect(database.query).not.toHaveBeenCalled();

    const ready = await app.request('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('drizzle.__drizzle_migrations'),
      [latestMigrationHash],
    );
  });

  it('rejects missing post-login redirect URIs during composition', () => {
    expect(() =>
      createRuntimeApp(
        client(),
        environment({ OIDC_POST_LOGIN_REDIRECT_URIS: '  ' }),
        { oidcProvider },
      ),
    ).toThrow('post-login redirect URI');
  });

  it.each([
    'OIDC_TRANSACTION_SECRET',
    'TOKEN_PEPPER',
    'SYNC_TOKEN_SECRET',
    'MAINTAINER_BOOTSTRAP_TOKEN',
  ] as const)('rejects a short %s during composition', (name) => {
    expect(() =>
      createRuntimeApp(client(), environment({ [name]: 'short' }), {
        oidcProvider,
      }),
    ).toThrow(`${name} must contain at least 32 characters.`);
  });

  it('rejects an invalid OIDC issuer in the production adapter', () => {
    expect(() =>
      createRuntimeApp(client(), environment({ OIDC_ISSUER: 'http://issuer.example' })),
    ).toThrow('OIDC issuer must be an HTTPS URL');
  });
});
