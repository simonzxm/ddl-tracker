import { describe, expect, it } from 'vitest';

import { publicSyncEventV2Schema } from '../src/sync/public-event.js';

const EVENT_ID = '018f0000-0000-7000-8000-000000000001';
const USER_ID = '018f0000-0000-7000-8000-000000000002';
const SECTION_ID = '018f0000-0000-7000-8000-000000000003';
const TASK_ID = '018f0000-0000-7000-8000-000000000004';
const NOW = '2026-09-01T00:30:00Z';

describe('public sync events v2', () => {
  it('requires a full current record when content is restored', () => {
    expect(
      publicSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'course_task_restored',
        occurred_at: NOW,
        payload: {
          id: TASK_ID,
          class_section_id: SECTION_ID,
          created_by: USER_ID,
          state: 'visible',
          revision: 3,
          created_at: NOW,
          updated_at: NOW,
        },
      }),
    ).toMatchObject({ type: 'course_task_restored' });

    expect(() =>
      publicSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'course_task_restored',
        occurred_at: NOW,
        payload: {
          entity_type: 'course_task',
          entity_id: TASK_ID,
          state: 'visible',
          revision: 3,
        },
      }),
    ).toThrow();
  });

  it('uses normalized profile revision names', () => {
    expect(() =>
      publicSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'public_user_profile_updated',
        occurred_at: NOW,
        payload: {
          id: USER_ID,
          username: 'student_1',
          display_name: 'Student One',
          avatar_url: null,
          bio: null,
          status: 'active',
          profile_revision: 2,
          created_at: NOW,
          updated_at: NOW,
        },
      }),
    ).toThrow();
  });

  it('requires timestamps on aggregate and deactivation events', () => {
    expect(() =>
      publicSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'proposal_vote_totals_updated',
        occurred_at: NOW,
        payload: {
          proposal_id: TASK_ID,
          up: 2,
          down: 1,
        },
      }),
    ).toThrow();

    expect(
      publicSyncEventV2Schema.parse({
        event_id: EVENT_ID,
        schema_version: 1,
        type: 'class_section_deactivated',
        occurred_at: NOW,
        payload: {
          id: SECTION_ID,
          external_section_id: '2026-001',
          active: false,
          revision: 2,
          updated_at: NOW,
        },
      }),
    ).toMatchObject({ type: 'class_section_deactivated' });
  });
});
