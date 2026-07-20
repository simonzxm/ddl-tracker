import type { Client } from 'pg';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_RETENTION_DAYS = 180;
const TEMPORARY_RETENTION_DAYS = 1;
const SESSION_DIAGNOSTIC_DAYS = 30;
const RETENTION_LOCK = 4_819_252;

export interface RetentionBatchResult {
  auth_challenges: number;
  registration_tokens: number;
  sessions: number;
  operation_receipts: number;
  rate_limit_counters: number;
  sync_events: number;
}

export class PostgresRetentionService {
  readonly #client: Client;
  readonly #createId: () => string;

  constructor(client: Client, options: { createId: () => string }) {
    this.#client = client;
    this.#createId = options.createId;
  }

  async runBatch(input: {
    now: Date;
    limit: number;
  }): Promise<RetentionBatchResult> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10_000) {
      throw new Error('Retention batch limit must be between 1 and 10000.');
    }
    await this.#client.query('begin');
    try {
      await this.#client.query('select pg_advisory_xact_lock($1)', [
        RETENTION_LOCK,
      ]);
      const temporaryCutoff = new Date(
        input.now.getTime() - TEMPORARY_RETENTION_DAYS * DAY_MS,
      );
      const sessionCutoff = new Date(
        input.now.getTime() - SESSION_DIAGNOSTIC_DAYS * DAY_MS,
      );
      const eventCutoff = new Date(
        input.now.getTime() - EVENT_RETENTION_DAYS * DAY_MS,
      );

      const authChallenges = await this.#deleteById(
        'auth_challenges',
        `(expires_at <= $1 or consumed_at <= $1)`,
        temporaryCutoff,
        input.limit,
      );
      const registrationTokens = await this.#deleteById(
        'registration_tokens',
        `(expires_at <= $1 or consumed_at <= $1)`,
        temporaryCutoff,
        input.limit,
      );
      const sessions = await this.#deleteById(
        'sessions',
        `(
          greatest(idle_expires_at, absolute_expires_at) <= $1
          or revoked_at <= $1
        )`,
        sessionCutoff,
        input.limit,
      );
      const operationReceipts = await this.#deleteReceipts(
        input.now,
        input.limit,
      );
      const rateLimitCounters = await this.#deleteRateLimitCounters(
        input.now,
        input.limit,
      );
      const syncEvents = await this.#deleteEvents(eventCutoff, input.limit);
      const result: RetentionBatchResult = {
        auth_challenges: authChallenges,
        registration_tokens: registrationTokens,
        sessions,
        operation_receipts: operationReceipts,
        rate_limit_counters: rateLimitCounters,
        sync_events: syncEvents.count,
      };
      await this.#client.query(
        `insert into audit_log (
           id, actor_id, action, target_type, target_id, reason, result,
           request_id, created_at
         ) values ($1, null, 'retention_cleanup', 'system', null,
                   'Scheduled bounded retention cleanup.', $2::jsonb,
                   $3, $4)`,
        [
          this.#createId(),
          JSON.stringify(result),
          this.#createId(),
          input.now,
        ],
      );
      await this.#client.query('commit');
      return result;
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }

  async #deleteById(
    table: 'auth_challenges' | 'registration_tokens' | 'sessions',
    predicate: string,
    cutoff: Date,
    limit: number,
  ): Promise<number> {
    const result = await this.#client.query(
      `with selected as (
         select id from ${table}
         where ${predicate}
         order by id
         limit $2
       )
       delete from ${table} target
       using selected
       where target.id = selected.id
       returning target.id`,
      [cutoff, limit],
    );
    return result.rowCount ?? 0;
  }

  async #deleteReceipts(now: Date, limit: number): Promise<number> {
    const result = await this.#client.query(
      `with selected as (
         select user_id, operation_id
         from operation_receipts
         where expires_at <= $1
         order by expires_at, user_id, operation_id
         limit $2
       )
       delete from operation_receipts target
       using selected
       where target.user_id = selected.user_id
         and target.operation_id = selected.operation_id
       returning target.operation_id`,
      [now, limit],
    );
    return result.rowCount ?? 0;
  }

  async #deleteRateLimitCounters(
    now: Date,
    limit: number,
  ): Promise<number> {
    const result = await this.#client.query(
      `with selected as (
         select scope, subject_key, window_start
         from rate_limit_counters
         where expires_at <= $1
         order by expires_at, scope, subject_key, window_start
         limit $2
       )
       delete from rate_limit_counters target
       using selected
       where target.scope = selected.scope
         and target.subject_key = selected.subject_key
         and target.window_start = selected.window_start
       returning target.scope`,
      [now, limit],
    );
    return result.rowCount ?? 0;
  }

  async #deleteEvents(
    cutoff: Date,
    limit: number,
  ): Promise<{ count: number; maximumSequence: number | null }> {
    const result = await this.#client.query<{ sequence: string }>(
      `with selected as (
         select sequence
         from sync_events
         where occurred_at < $1
         order by sequence
         limit $2
       ), deleted as (
         delete from sync_events target
         using selected
         where target.sequence = selected.sequence
         returning target.sequence
       )
       select sequence::text as sequence from deleted
       order by sequence`,
      [cutoff, limit],
    );
    const maximum = result.rows.at(-1);
    const maximumSequence =
      maximum === undefined ? null : Number(maximum.sequence);
    if (maximumSequence !== null) {
      await this.#client.query(
        `insert into sync_event_retention (
           singleton_id, minimum_sequence, updated_at
         ) values (1, $1, now())
         on conflict (singleton_id) do update
         set minimum_sequence = greatest(
               sync_event_retention.minimum_sequence,
               excluded.minimum_sequence
             ),
             updated_at = excluded.updated_at`,
        [maximumSequence + 1],
      );
    }
    return { count: result.rowCount ?? 0, maximumSequence };
  }
}
