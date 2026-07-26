import { describe, expect, it } from 'vitest';

import { snapshotRecordV2Schema } from '../src/sync/snapshot-record.js';

const ID = '018f0000-0000-7000-8000-000000000001';
const SECTION_ID = '018f0000-0000-7000-8000-000000000002';
const NOW = '2026-09-01T00:30:00Z';

describe('snapshot record v2', () => {
  it('narrows payload by record type', () => {
    const record = snapshotRecordV2Schema.parse({
      record_type: 'personal_todo',
      schema_version: 1,
      payload: {
        id: ID,
        class_section_id: SECTION_ID,
        title: 'Read chapter 3',
        deadline: null,
        note: null,
        state: 'pending',
        revision: 1,
        deleted_at: null,
        created_at: NOW,
        updated_at: NOW,
      },
    });

    expect(record.record_type).toBe('personal_todo');
    if (record.record_type === 'personal_todo') {
      expect(record.payload.title).toBe('Read chapter 3');
    }
  });

  it('rejects duplicated envelope fields', () => {
    expect(() =>
      snapshotRecordV2Schema.parse({
        record_type: 'followed_class_section',
        schema_version: 1,
        id: SECTION_ID,
        revision: 0,
        payload: {
          class_section_id: SECTION_ID,
          followed_at: NOW,
        },
      }),
    ).toThrow();
  });

  it('rejects a payload for another record type', () => {
    expect(() =>
      snapshotRecordV2Schema.parse({
        record_type: 'personal_task_state',
        schema_version: 1,
        payload: {
          id: ID,
          class_section_id: null,
          title: 'Unexpected shape',
          deadline: null,
          note: null,
          state: 'pending',
          revision: 1,
          deleted_at: null,
          created_at: NOW,
          updated_at: NOW,
        },
      }),
    ).toThrow();
  });
});
