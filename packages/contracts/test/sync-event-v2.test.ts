import { describe, expect, it } from 'vitest';

import { syncEventV2Schema } from '../src/sync/event-v2.js';

const EVENT_ID = '018f0000-0000-7000-8000-000000000001';
const TASK_ID = '018f0000-0000-7000-8000-000000000002';
const SECTION_ID = '018f0000-0000-7000-8000-000000000003';
const NOW = '2026-09-01T00:30:00Z';

describe('sync event v2 registry', () => {
  it('narrows payloads from one event registry', () => {
    const event = syncEventV2Schema.parse({
      event_id: EVENT_ID,
      schema_version: 2,
      type: 'course_task_created',
      occurred_at: NOW,
      payload: {
        id: TASK_ID,
        class_section_id: SECTION_ID,
        created_by: null,
        state: 'visible',
        revision: 1,
        created_at: NOW,
        updated_at: NOW,
      },
    });

    expect(event.type).toBe('course_task_created');
    if (event.type === 'course_task_created') {
      expect(event.payload.class_section_id).toBe(SECTION_ID);
    }
  });

  it('rejects generic payloads and legacy report event types', () => {
    expect(() =>
      syncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'personal_task_state_upserted',
        occurred_at: NOW,
        payload: { revision: 1 },
      }),
    ).toThrow();

    expect(() =>
      syncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'content_report_status_updated',
        occurred_at: NOW,
        payload: {},
      }),
    ).toThrow();
  });
});
