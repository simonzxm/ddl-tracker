import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PostgresRateLimiter,
  type RateLimitRule,
} from '../src/security/postgres-rate-limiter.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const NOW = new Date('2026-07-19T12:00:30.000Z');

const minuteRule: RateLimitRule = {
  scope: 'test_minute',
  limit: 2,
  windowSeconds: 60,
};

describePostgres('PostgresRateLimiter', () => {
  let client: Client;
  let limiter: PostgresRateLimiter;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    limiter = new PostgresRateLimiter(client);
  });

  beforeEach(async () => {
    await client.query('truncate table rate_limit_counters');
  });

  afterAll(async () => {
    await client.end();
  });

  it('denies after the fixed-window limit with retry metadata', async () => {
    await expect(
      limiter.consume({ subjectKey: 'user-1', rules: [minuteRule], now: NOW }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      limiter.consume({ subjectKey: 'user-1', rules: [minuteRule], now: NOW }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      limiter.consume({ subjectKey: 'user-1', rules: [minuteRule], now: NOW }),
    ).resolves.toEqual({
      allowed: false,
      retryAfter: 30,
      scope: 'test_minute',
    });

    const count = await client.query<{ count: number }>(
      `select count from rate_limit_counters
       where scope = 'test_minute' and subject_key = 'user-1'`,
    );
    expect(count.rows[0]?.count).toBe(2);
  });

  it('rolls back earlier windows when a later rule is exhausted', async () => {
    const rules: RateLimitRule[] = [
      { scope: 'test_burst', limit: 5, windowSeconds: 10 },
      { scope: 'test_daily', limit: 1, windowSeconds: 86_400 },
    ];
    await limiter.consume({ subjectKey: 'user-2', rules, now: NOW });

    await expect(
      limiter.consume({ subjectKey: 'user-2', rules, now: NOW }),
    ).resolves.toMatchObject({ allowed: false, scope: 'test_daily' });

    const counts = await client.query<{ scope: string; count: number }>(
      `select scope, count from rate_limit_counters
       where subject_key = 'user-2'
       order by scope`,
    );
    expect(counts.rows).toEqual([
      { scope: 'test_burst', count: 1 },
      { scope: 'test_daily', count: 1 },
    ]);
  });

  it('admits exactly the available number of concurrent requests', async () => {
    const clients = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const value = new Client({ connectionString: databaseUrl });
        await value.connect();
        return value;
      }),
    );
    try {
      const results = await Promise.all(
        clients.map((value) =>
          new PostgresRateLimiter(value).consume({
            subjectKey: 'user-3',
            rules: [{ scope: 'test_concurrent', limit: 5, windowSeconds: 60 }],
            now: NOW,
          }),
        ),
      );
      expect(results.filter(({ allowed }) => allowed)).toHaveLength(5);
      expect(results.filter(({ allowed }) => !allowed)).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((value) => value.end()));
    }
  });
});
