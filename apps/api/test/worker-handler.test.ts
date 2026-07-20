import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { MailDelivery } from '../src/auth/email-challenge-service.js';
import { latestMigrationHash } from '../src/db/latest-migration.js';
import { createWorkerHandler } from '../src/worker-handler.js';

function environment(): Env {
  return {
    HYPERDRIVE: {
      connectionString: 'postgresql://hyperdrive.invalid/database',
    } as Hyperdrive,
    APP_ENVIRONMENT: 'development',
    ALLOWED_EMAIL_DOMAINS: 'example.edu',
    SMTP_HOST: 'smtp.example.edu',
    SMTP_PORT: '465',
    SMTP_FROM_ADDRESS: 'mailer@example.edu',
    SMTP_FROM_NAME: 'DDL Tracker',
    OTP_HMAC_SECRET: 'o'.repeat(64),
    TOKEN_PEPPER: 'p'.repeat(64),
    SYNC_TOKEN_SECRET: 's'.repeat(64),
    MAINTAINER_BOOTSTRAP_TOKEN: 'b'.repeat(64),
    SMTP_USERNAME: 'mailer@example.edu',
    SMTP_PASSWORD: 'smtp-password',
  };
}

function fakeClient(options?: { queryError?: Error }) {
  return {
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    query: vi.fn(async () => {
      if (options?.queryError !== undefined) throw options.queryError;
      return { rows: [{ hash: latestMigrationHash }], rowCount: 1 };
    }),
  };
}

const mailDelivery: MailDelivery = {
  sendVerificationCode: vi.fn(async () => undefined),
};

const context = {} as ExecutionContext;

describe('createWorkerHandler', () => {
  it('serves and logs liveness without constructing a database client', async () => {
    const createClient = vi.fn(() => fakeClient() as unknown as Client);
    const entries: unknown[] = [];
    const handler = createWorkerHandler({
      createClient,
      mailDelivery,
      logRequest: (entry) => {
        entries.push(entry);
      },
    });

    const response = await handler.fetch(
      new Request('https://api.example/health/live'),
      environment(),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(entries).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/health/live',
        status: 200,
      }),
    ]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('connects one Hyperdrive client and closes it after a request', async () => {
    const client = fakeClient();
    const createClient = vi.fn(() => client as unknown as Client);
    const handler = createWorkerHandler({ createClient, mailDelivery });

    const response = await handler.fetch(
      new Request('https://api.example/health/ready'),
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
    const retention = {
      runBatch: vi.fn(async () => undefined),
    };
    const handler = createWorkerHandler({
      createClient: () => client as unknown as Client,
      createRetentionRunner: () => retention,
      mailDelivery,
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
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('closes the client after an application failure response', async () => {
    const client = fakeClient({ queryError: new Error('database failed') });
    const handler = createWorkerHandler({
      createClient: () => client as unknown as Client,
      mailDelivery,
    });

    const response = await handler.fetch(
      new Request('https://api.example/health/ready'),
      environment(),
      context,
    );

    expect(response.status).toBe(503);
    expect(client.end).toHaveBeenCalledOnce();
  });
});
