import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { MailDelivery } from '../src/auth/email-challenge-service.js';
import { latestMigrationHash } from '../src/db/latest-migration.js';
import { createRuntimeApp } from '../src/runtime-app.js';

function environment(overrides: Partial<Env> = {}): Env {
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
    MAINTAINER_BOOTSTRAP_TOKEN: 'bootstrap-secret',
    SMTP_USERNAME: 'mailer@example.edu',
    SMTP_PASSWORD: 'smtp-password',
    ...overrides,
  };
}

function client() {
  return {
    query: vi.fn(async () => ({
      rows: [{ hash: latestMigrationHash }],
      rowCount: 1,
    })),
  } as unknown as Client;
}

const mailDelivery: MailDelivery = {
  sendVerificationCode: vi.fn(async () => undefined),
};

describe('createRuntimeApp', () => {
  it('serves liveness without querying PostgreSQL and readiness with the same client', async () => {
    const database = client();
    const app = createRuntimeApp(database, environment(), { mailDelivery });

    const live = await app.request('/health/live');
    expect(live.status).toBe(200);
    expect(database.query).not.toHaveBeenCalled();

    const ready = await app.request('/health/ready');
    expect(ready.status).toBe(200);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('drizzle.__drizzle_migrations'),
    );
  });

  it('rejects missing institutional domains during composition', () => {
    expect(() =>
      createRuntimeApp(
        client(),
        environment({ ALLOWED_EMAIL_DOMAINS: '  ' }),
        { mailDelivery },
      ),
    ).toThrow('allowed institutional email domain');
  });

  it('rejects non-TLS SMTP ports in the production adapter', () => {
    expect(() =>
      createRuntimeApp(client(), environment({ SMTP_PORT: '25' })),
    ).toThrow('465 or 587');
  });
});
