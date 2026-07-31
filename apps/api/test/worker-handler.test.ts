import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { OidcProvider } from '../src/auth/oidc-provider-client.js';
import { createWorkerHandler } from '../src/worker-handler.js';

function environment(): Env {
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
  };
}

function fakeClient(options?: { queryError?: Error }) {
  return {
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    query: vi.fn(async () => {
      if (options?.queryError !== undefined) throw options.queryError;
      return { rows: [{ applied: true }], rowCount: 1 };
    }),
  };
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
const context = {} as ExecutionContext;

describe('createWorkerHandler', () => {
  it('serves and logs liveness without constructing a database client', async () => {
    const createClient = vi.fn(() => fakeClient() as unknown as Client);
    const entries: unknown[] = [];
    const handler = createWorkerHandler({
      createClient,
      oidcProvider,
      logRequest: (entry) => entries.push(entry),
    });

    const response = await handler.fetch(
      new Request('https://api.example/api/health/live'),
      environment(),
      context,
    );
    expect(response.status).toBe(200);
    expect(createClient).not.toHaveBeenCalled();
    expect(entries).toEqual([
      expect.objectContaining({ method: 'GET', status: 200 }),
    ]);
  });

  it('returns a generic 503 when the database connection cannot be opened', async () => {
    const client = {
      connect: vi.fn(async () => {
        throw new Error('postgresql://secret-host/private');
      }),
      end: vi.fn(async () => undefined),
    };
    const handler = createWorkerHandler({
      createClient: () => client as unknown as Client,
      oidcProvider,
    });
    const response = await handler.fetch(
      new Request('https://api.example/api/v1/terms'),
      environment(),
      context,
    );
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).not.toContain('secret-host');
    expect(client.end).not.toHaveBeenCalled();
  });

  it('connects one Hyperdrive client and closes it after a request', async () => {
    const client = fakeClient();
    const createClient = vi.fn(() => client as unknown as Client);
    const handler = createWorkerHandler({ createClient, oidcProvider });
    const response = await handler.fetch(
      new Request('https://api.example/api/health/ready'),
      environment(),
      context,
    );
    expect(response.status).toBe(200);
    expect(createClient).toHaveBeenCalledWith(
      'postgresql://hyperdrive.invalid/database',
    );
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('runs bounded retention with one client on the scheduled timestamp', async () => {
    const client = fakeClient();
    const retention = { runBatch: vi.fn(async () => undefined) };
    const handler = createWorkerHandler({
      createClient: () => client as unknown as Client,
      createRetentionRunner: () => retention,
      oidcProvider,
    });
    const controller = {
      cron: '17 3 * * *',
      scheduledTime: Date.parse('2026-07-20T03:17:00.000Z'),
      noRetry: vi.fn(),
    } as unknown as ScheduledController;
    await handler.scheduled(controller, environment(), context);
    expect(retention.runBatch).toHaveBeenCalledWith({
      now: new Date('2026-07-20T03:17:00.000Z'),
      limit: 1000,
    });
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('closes the client after an application failure response', async () => {
    const client = fakeClient({ queryError: new Error('database failed') });
    const handler = createWorkerHandler({
      createClient: () => client as unknown as Client,
      oidcProvider,
    });
    const response = await handler.fetch(
      new Request('https://api.example/api/health/ready'),
      environment(),
      context,
    );
    expect(response.status).toBe(503);
    expect(client.end).toHaveBeenCalledOnce();
  });
});
