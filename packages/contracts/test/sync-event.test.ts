import { describe, expect, it } from 'vitest';
import {
  syncEventSchema,
  syncEventScopeSchema,
  syncEventTypeSchema,
} from '../src/sync/event.js';

const EVENT_ID = '018f0000-0000-7000-8000-000000000001';
const TASK_ID = '018f0000-0000-7000-8000-000000000002';
const NOW = '2026-09-01T00:30:00Z';

describe('sync event registry', () => {
  it('accepts all documented visibility scopes', () => {
    for (const scope of [
      'private_user',
      'class_section_public',
      'authenticated_global',
      'maintainer_private',
    ] as const) {
      expect(syncEventScopeSchema.parse(scope)).toBe(scope);
    }
  });

  it('exports the normalized report event types', () => {
    expect(syncEventTypeSchema.parse('reporter_content_report_updated')).toBe(
      'reporter_content_report_updated',
    );
    expect(syncEventTypeSchema.parse('maintainer_content_report_updated')).toBe(
      'maintainer_content_report_updated',
    );
    expect(() =>
      syncEventTypeSchema.parse('content_report_status_updated'),
    ).toThrow();
  });

  it('canonicalizes complete typed events without exposing sequence', () => {
    expect(
      syncEventSchema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'personal_task_state_upserted',
        occurred_at: '2026-09-01T08:30:00+08:00',
        payload: {
          course_task_id: TASK_ID,
          state: 'completed',
          revision: 4,
          created_at: NOW,
          updated_at: NOW,
        },
      }),
    ).toEqual({
      event_id: EVENT_ID,
      schema_version: 2,
      type: 'personal_task_state_upserted',
      occurred_at: '2026-09-01T00:30:00.000Z',
      payload: {
        course_task_id: TASK_ID,
        state: 'completed',
        revision: 4,
        created_at: '2026-09-01T00:30:00.000Z',
        updated_at: '2026-09-01T00:30:00.000Z',
      },
    });
  });

  it('rejects incomplete payloads, old versions, and internal fields', () => {
    expect(() =>
      syncEventSchema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'personal_task_state_upserted',
        occurred_at: NOW,
        payload: { revision: 4 },
      }),
    ).toThrow();
    expect(() =>
      syncEventSchema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'personal_task_state_upserted',
        occurred_at: NOW,
        payload: {},
      }),
    ).toThrow();
    expect(() =>
      syncEventSchema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'personal_task_state_upserted',
        occurred_at: NOW,
        payload: {
          course_task_id: TASK_ID,
          state: 'completed',
          revision: 4,
          created_at: NOW,
          updated_at: NOW,
        },
        sequence: 42,
      }),
    ).toThrow();
  });
});
