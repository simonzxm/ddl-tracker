import { HttpError } from '../http/errors.js';
import type {
  RateLimitConsumer,
  RateLimitRule,
} from './postgres-rate-limiter.js';

const SYNC_RULES = [
  { scope: 'sync_user_burst', limit: 5, windowSeconds: 10 },
  { scope: 'sync_user_minute', limit: 30, windowSeconds: 60 },
] as const satisfies readonly RateLimitRule[];

const READ_RULES = [
  { scope: 'authenticated_read_minute', limit: 120, windowSeconds: 60 },
] as const satisfies readonly RateLimitRule[];

const ADMIN_MUTATION_RULES = [
  { scope: 'admin_mutation_minute', limit: 30, windowSeconds: 60 },
] as const satisfies readonly RateLimitRule[];

export class RequestRateLimitService {
  readonly #consumer: RateLimitConsumer;
  readonly #now: () => Date;

  constructor(
    consumer: RateLimitConsumer,
    options: { now?: () => Date } = {},
  ) {
    this.#consumer = consumer;
    this.#now = options.now ?? (() => new Date());
  }

  consumeSync(userId: string): Promise<void> {
    return this.#consume(userId, SYNC_RULES);
  }

  consumeRead(userId: string): Promise<void> {
    return this.#consume(userId, READ_RULES);
  }

  consumeAdminMutation(userId: string): Promise<void> {
    return this.#consume(userId, ADMIN_MUTATION_RULES);
  }

  async #consume(
    subjectKey: string,
    rules: readonly RateLimitRule[],
  ): Promise<void> {
    const decision = await this.#consumer.consume({
      subjectKey,
      rules,
      now: this.#now(),
    });
    if (decision.allowed) return;
    throw new HttpError({
      code: 'rate_limited',
      message: 'Too many requests.',
      retryable: true,
      retryAfter: decision.retryAfter,
      status: 429,
    });
  }
}
