import { describe, expect, it } from 'vitest';

import { RequestRateLimitService } from '../src/security/request-rate-limit-service.js';
import type {
  RateLimitConsumer,
  RateLimitDecision,
  RateLimitRule,
} from '../src/security/postgres-rate-limiter.js';

const NOW = new Date('2026-07-19T12:00:00.000Z');
const USER_ID = '018f0000-0000-7000-8000-000000004001';

class FakeConsumer implements RateLimitConsumer {
  decision: RateLimitDecision = { allowed: true };
  calls: { subjectKey: string; rules: readonly RateLimitRule[]; now: Date }[] = [];

  async consume(input: {
    subjectKey: string;
    rules: readonly RateLimitRule[];
    now: Date;
  }): Promise<RateLimitDecision> {
    this.calls.push(input);
    return this.decision;
  }
}

function service(consumer: FakeConsumer) {
  return new RequestRateLimitService(consumer, { now: () => NOW });
}

describe('RequestRateLimitService', () => {
  it('applies burst and minute windows to sync', async () => {
    const consumer = new FakeConsumer();

    await service(consumer).consumeSync(USER_ID);

    expect(consumer.calls).toEqual([
      {
        subjectKey: USER_ID,
        now: NOW,
        rules: [
          { scope: 'sync_user_burst', limit: 5, windowSeconds: 10 },
          { scope: 'sync_user_minute', limit: 30, windowSeconds: 60 },
        ],
      },
    ]);
  });

  it('applies documented read and admin mutation windows', async () => {
    const consumer = new FakeConsumer();
    const limiter = service(consumer);

    await limiter.consumeRead(USER_ID);
    await limiter.consumeAdminMutation(USER_ID);

    expect(consumer.calls.map(({ rules }) => rules)).toEqual([
      [{ scope: 'authenticated_read_minute', limit: 120, windowSeconds: 60 }],
      [{ scope: 'admin_mutation_minute', limit: 30, windowSeconds: 60 }],
    ]);
  });

  it('maps a denial to one generic retryable API error', async () => {
    const consumer = new FakeConsumer();
    consumer.decision = {
      allowed: false,
      retryAfter: 17,
      scope: 'sync_user_burst',
    };

    await expect(service(consumer).consumeSync(USER_ID)).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Too many requests.',
      retryable: true,
      retryAfter: 17,
      details: {},
    });
  });
});
