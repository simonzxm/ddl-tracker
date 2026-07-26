import { describe, expect, it } from 'vitest';

import { privateSyncEventV2Schema } from '../src/sync/private-event.js';

const EVENT_ID = '018f0000-0000-7000-8000-000000000001';
const ENTITY_ID = '018f0000-0000-7000-8000-000000000002';
const NOW = '2026-09-01T00:30:00Z';

describe('private sync events v2', () => {
  it('requires complete upsert payloads', () => {
    expect(
      privateSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'personal_task_state_upserted',
        occurred_at: NOW,
        payload: {
          course_task_id: ENTITY_ID,
          state: 'completed',
          revision: 2,
          created_at: NOW,
          updated_at: NOW,
        },
      }),
    ).toMatchObject({ type: 'personal_task_state_upserted' });

    expect(() =>
      privateSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'personal_task_state_upserted',
        occurred_at: NOW,
        payload: { course_task_id: ENTITY_ID, revision: 2 },
      }),
    ).toThrow();
  });

  it('requires timestamps on current-vote events', () => {
    expect(() =>
      privateSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'accuracy_vote_updated',
        occurred_at: NOW,
        payload: {
          proposal_id: ENTITY_ID,
          value: 'none',
          reason: 'task_merge_conflict',
        },
      }),
    ).toThrow();
  });

  it('uses an explicit reporter event type', () => {
    expect(
      privateSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'reporter_content_report_updated',
        occurred_at: NOW,
        payload: {
          report_id: ENTITY_ID,
          target_type: 'course_task',
          target_id: ENTITY_ID,
          reason: 'inaccurate',
          details: 'The shared task contains private information.',
          status: 'open',
          resolution: null,
          created_at: NOW,
          resolved_at: null,
        },
      }),
    ).toMatchObject({ type: 'reporter_content_report_updated' });

    expect(() =>
      privateSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'reporter_content_report_updated',
        occurred_at: NOW,
        payload: {
          report_id: ENTITY_ID,
          status: 'resolved',
          resolution: 'Reviewed.',
          resolved_at: NOW,
        },
      }),
    ).toThrow();

    expect(() =>
      privateSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'content_report_status_updated',
        occurred_at: NOW,
        payload: {},
      }),
    ).toThrow();
  });
});
