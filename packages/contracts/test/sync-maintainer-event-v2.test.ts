import { describe, expect, it } from 'vitest';

import { maintainerSyncEventV2Schema } from '../src/sync/maintainer-event.js';

const EVENT_ID = '018f0000-0000-7000-8000-000000000001';
const REPORT_ID = '018f0000-0000-7000-8000-000000000002';
const USER_ID = '018f0000-0000-7000-8000-000000000003';
const TARGET_ID = '018f0000-0000-7000-8000-000000000004';
const NOW = '2026-09-01T00:30:00Z';

describe('maintainer sync events v2', () => {
  it('uses a complete report record for maintainer updates', () => {
    expect(
      maintainerSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'maintainer_content_report_updated',
        occurred_at: NOW,
        payload: {
          report_id: REPORT_ID,
          reporter_id: USER_ID,
          target_type: 'course_task',
          target_id: TARGET_ID,
          reason: 'inaccurate',
          details: 'D'.repeat(1_001),
          status: 'resolved',
          resolution: 'R'.repeat(1_001),
          created_at: NOW,
          resolved_at: NOW,
        },
      }),
    ).toMatchObject({ type: 'maintainer_content_report_updated' });
  });

  it('replays empty historical resolutions stored before current request rules', () => {
    const event = maintainerSyncEventV2Schema.parse({
      event_id: EVENT_ID,
      schema_version: 2,
      type: 'maintainer_content_report_updated',
      occurred_at: NOW,
      payload: {
        report_id: REPORT_ID,
        reporter_id: USER_ID,
        target_type: 'course_task',
        target_id: TARGET_ID,
        reason: 'inaccurate',
        details: null,
        status: 'dismissed',
        resolution: '',
        created_at: NOW,
        resolved_at: NOW,
      },
    });

    expect(event.payload.resolution).toBe('');
  });

  it('rejects incomplete maintainer report payloads', () => {
    expect(() =>
      maintainerSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 2,
        type: 'maintainer_content_report_updated',
        occurred_at: NOW,
        payload: {
          report_id: REPORT_ID,
          status: 'resolved',
          resolution: 'Reviewed.',
          resolved_at: NOW,
        },
      }),
    ).toThrow();
  });
});
