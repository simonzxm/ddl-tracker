import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresSyncEventStore } from '../src/sync/postgres-event-store.js';

const EVENT_ID = '018f0000-0000-7000-8000-000000000001';
const USER_ID = '018f0000-0000-7000-8000-000000000002';
const TASK_ID = '018f0000-0000-7000-8000-000000000003';
const NOW = new Date('2026-09-01T00:30:00Z');

describe('PostgresSyncEventStore', () => {
  it('validates and appends private events with their scope target', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const store = new PostgresSyncEventStore(
      { query } as unknown as Client,
      { createId: () => EVENT_ID },
    );

    const event = await store.append({
      scope: 'private_user',
      userId: USER_ID,
      occurredAt: NOW,
      event: {
        type: 'personal_task_state_upserted',
        payload: {
          course_task_id: TASK_ID,
          state: 'completed',
          revision: 2,
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        },
      },
    });

    expect(event).toMatchObject({
      event_id: EVENT_ID,
      schema_version: 2,
      type: 'personal_task_state_upserted',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('insert into sync_events'),
      [
        EVENT_ID,
        'private_user',
        USER_ID,
        null,
        'personal_task_state_upserted',
        2,
        expect.any(String),
        NOW,
      ],
    );
  });

  it('rejects invalid payloads before issuing SQL', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const store = new PostgresSyncEventStore(
      { query } as unknown as Client,
      { createId: () => EVENT_ID },
    );

    await expect(
      store.append({
        scope: 'private_user',
        userId: USER_ID,
        occurredAt: NOW,
        event: {
          type: 'accuracy_vote_updated',
          payload: {
            proposal_id: TASK_ID,
            value: 'none',
          },
        },
      } as never),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
