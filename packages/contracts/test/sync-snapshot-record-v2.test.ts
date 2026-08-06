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

  it('restores the current catalog revision', () => {
    const record = snapshotRecordV2Schema.parse({
      record_type: 'catalog_revision',
      schema_version: 1,
      payload: {
        revision: 7,
        updated_at: NOW,
      },
    });

    expect(record).toMatchObject({
      record_type: 'catalog_revision',
      payload: { revision: 7 },
    });
  });

  it('restores complete reporter report state', () => {
    const record = snapshotRecordV2Schema.parse({
      record_type: 'reporter_content_report',
      schema_version: 1,
      payload: {
        report_id: ID,
        target_type: 'course_task',
        target_id: SECTION_ID,
        reason: 'privacy',
        details: 'D'.repeat(1_001),
        status: 'resolved',
        resolution: 'R'.repeat(1_001),
        created_at: NOW,
        resolved_at: NOW,
      },
    });

    expect(record.record_type).toBe('reporter_content_report');
  });

  it('restores empty historical report resolutions', () => {
    const record = snapshotRecordV2Schema.parse({
      record_type: 'reporter_content_report',
      schema_version: 1,
      payload: {
        report_id: ID,
        target_type: 'course_task',
        target_id: SECTION_ID,
        reason: 'other',
        details: null,
        status: 'dismissed',
        resolution: '',
        created_at: NOW,
        resolved_at: NOW,
      },
    });

    expect(record.record_type).toBe('reporter_content_report');
    if (record.record_type === 'reporter_content_report') {
      expect(record.payload.resolution).toBe('');
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
