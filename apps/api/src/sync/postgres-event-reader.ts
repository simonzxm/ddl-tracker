import type { Client } from 'pg';

export interface SyncEventValue {
  event_id: string;
  schema_version: number;
  type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface SyncEventPage {
  events: SyncEventValue[];
  nextSequence: number;
  hasMore: boolean;
}

interface EventRow {
  sequence: string;
  event_id: string;
  scope:
    | 'private_user'
    | 'class_section_public'
    | 'authenticated_global'
    | 'maintainer_private';
  scope_user_id: string | null;
  class_section_id: string | null;
  type: string;
  schema_version: number;
  payload: unknown;
  occurred_at: Date;
  follows_section: boolean;
}

export class SyncCursorExpiredError extends Error {
  readonly minimumSequence: number;

  constructor(minimumSequence: number) {
    super('Sync cursor is older than the retained event window.');
    this.name = 'SyncCursorExpiredError';
    this.minimumSequence = minimumSequence;
  }
}

function safeSequence(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Sync event sequence exceeds the safe integer range.');
  }
  return parsed;
}

function eventPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stored sync event payload is invalid.');
  }
  return value as Record<string, unknown>;
}

function visible(row: EventRow, userId: string, maintainer: boolean): boolean {
  switch (row.scope) {
    case 'authenticated_global':
      return true;
    case 'private_user':
      return row.scope_user_id === userId;
    case 'class_section_public':
      return row.follows_section;
    case 'maintainer_private':
      return maintainer;
  }
}

export class PostgresSyncEventReader {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async pull(input: {
    userId: string;
    maintainer: boolean;
    afterSequence: number;
    limit: number;
  }): Promise<SyncEventPage> {
    if (
      !Number.isSafeInteger(input.afterSequence) ||
      input.afterSequence < 0 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 500
    ) {
      throw new Error('Invalid sync event pull bounds.');
    }

    const retention = await this.#client.query<{
      minimum_sequence: string;
    }>(
      `select minimum_sequence::text
       from sync_event_retention
       where singleton_id = 1`,
    );
    const minimumSequence = safeSequence(
      retention.rows[0]?.minimum_sequence ?? '0',
    );
    if (input.afterSequence < minimumSequence) {
      throw new SyncCursorExpiredError(minimumSequence);
    }

    const collected: { sequence: number; event: SyncEventValue }[] = [];
    let scanAfter = input.afterSequence;
    let exhausted = false;
    const scanLimit = Math.max(100, Math.min(1000, input.limit * 4));

    while (!exhausted && collected.length <= input.limit) {
      const result = await this.#client.query<EventRow>(
        `select e.sequence::text, e.event_id, e.scope, e.scope_user_id,
                e.class_section_id, e.type, e.schema_version, e.payload,
                e.occurred_at,
                exists (
                  select 1
                  from followed_class_sections f
                  where f.user_id = $1
                    and f.class_section_id = e.class_section_id
                ) as follows_section
         from sync_events e
         where e.sequence > $2
         order by e.sequence
         limit $3`,
        [input.userId, scanAfter, scanLimit],
      );
      if (result.rows.length === 0) {
        break;
      }
      for (const row of result.rows) {
        const sequence = safeSequence(row.sequence);
        scanAfter = sequence;
        if (visible(row, input.userId, input.maintainer)) {
          collected.push({
            sequence,
            event: {
              event_id: row.event_id,
              schema_version: row.schema_version,
              type: row.type,
              occurred_at: row.occurred_at.toISOString(),
              payload: eventPayload(row.payload),
            },
          });
          if (collected.length > input.limit) {
            break;
          }
        }
      }
      exhausted = result.rows.length < scanLimit;
    }

    const hasMore = collected.length > input.limit;
    const returned = collected.slice(0, input.limit);
    const lastReturned = returned.at(-1);
    return {
      events: returned.map(({ event }) => event),
      nextSequence: hasMore
        ? (lastReturned?.sequence ?? input.afterSequence)
        : scanAfter,
      hasMore,
    };
  }
}
