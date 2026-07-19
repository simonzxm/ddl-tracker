import { describe, expect, it } from 'vitest';
import {
  syncEventSchema,
  syncEventScopeSchema,
} from '../src/sync/event.js';

const EVENT_ID = '018f0000-0000-7000-8000-000000000001';

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

  it('canonicalizes versioned transport events without exposing sequence', () => {
    expect(
      syncEventSchema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'personal_task_state_upserted',
        occurred_at: '2026-09-01T08:30:00+08:00',
        payload: { revision: 4 },
      }),
    ).toEqual({
      event_id: EVENT_ID,
      schema_version: 1,
      type: 'personal_task_state_upserted',
      occurred_at: '2026-09-01T00:30:00.000Z',
      payload: { revision: 4 },
    });
  });

  it('rejects unknown types, versions, and leaked internal fields', () => {
    expect(() =>
      syncEventSchema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'personal_task_state_upserted',
        occurred_at: '2026-09-01T00:30:00Z',
        payload: {},
      }),
    ).toThrow();
    expect(() =>
      syncEventSchema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'database_rewritten',
        occurred_at: '2026-09-01T00:30:00Z',
        payload: {},
      }),
    ).toThrow();
    expect(() =>
      syncEventSchema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'personal_task_state_upserted',
        occurred_at: '2026-09-01T00:30:00Z',
        payload: {},
        sequence: 42,
      }),
    ).toThrow();
  });
});
