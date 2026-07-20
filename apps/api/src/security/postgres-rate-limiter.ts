import type { Client } from 'pg';

export interface RateLimitRule {
  scope: string;
  limit: number;
  windowSeconds: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfter: number; scope: string };

export interface RateLimitConsumer {
  consume(input: {
    subjectKey: string;
    rules: readonly RateLimitRule[];
    now: Date;
  }): Promise<RateLimitDecision>;
}

interface CounterRow {
  count: number;
}

export class PostgresRateLimiter implements RateLimitConsumer {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async consume(input: {
    subjectKey: string;
    rules: readonly RateLimitRule[];
    now: Date;
  }): Promise<RateLimitDecision> {
    validateInput(input.subjectKey, input.rules, input.now);
    await this.#client.query('begin');
    try {
      for (const rule of input.rules) {
        const window = windowFor(input.now, rule.windowSeconds);
        const result = await this.#client.query<CounterRow>(
          `insert into rate_limit_counters (
             scope, subject_key, window_start, count, expires_at
           ) values ($1, $2, $3, 1, $4)
           on conflict (scope, subject_key, window_start) do update
           set count = rate_limit_counters.count + 1,
               expires_at = excluded.expires_at
           where rate_limit_counters.count < $5
           returning count`,
          [
            rule.scope,
            input.subjectKey,
            window.start,
            window.expiresAt,
            rule.limit,
          ],
        );
        if (result.rowCount !== 1) {
          await this.#client.query('rollback');
          return {
            allowed: false,
            retryAfter: Math.max(
              1,
              Math.ceil(
                (window.expiresAt.getTime() - input.now.getTime()) / 1000,
              ),
            ),
            scope: rule.scope,
          };
        }
      }
      await this.#client.query('commit');
      return { allowed: true };
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }
}

function windowFor(
  now: Date,
  windowSeconds: number,
): { start: Date; expiresAt: Date } {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const startSeconds =
    Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  return {
    start: new Date(startSeconds * 1000),
    expiresAt: new Date((startSeconds + windowSeconds) * 1000),
  };
}

function validateInput(
  subjectKey: string,
  rules: readonly RateLimitRule[],
  now: Date,
): void {
  if (subjectKey.length < 1 || subjectKey.length > 256) {
    throw new Error('Rate limit subject key must contain 1-256 characters.');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error('Rate limit time is invalid.');
  }
  if (rules.length < 1 || rules.length > 10) {
    throw new Error('Rate limiting requires 1-10 rules.');
  }
  for (const rule of rules) {
    if (!/^[a-z0-9:_-]{1,100}$/u.test(rule.scope)) {
      throw new Error('Rate limit scope is invalid.');
    }
    if (!Number.isSafeInteger(rule.limit) || rule.limit < 1) {
      throw new Error('Rate limit must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(rule.windowSeconds) || rule.windowSeconds < 1) {
      throw new Error('Rate limit window must be a positive safe integer.');
    }
  }
}
