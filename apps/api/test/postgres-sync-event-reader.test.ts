import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PostgresSyncEventReader,
  SyncCursorExpiredError,
} from '../src/sync/postgres-event-reader.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000002201';
const OTHER_USER_ID = '018f0000-0000-7000-8000-000000002202';
const TERM_ID = '018f0000-0000-7000-8000-000000002203';
const COURSE_ID = '018f0000-0000-7000-8000-000000002204';
const SECTION_ID = '018f0000-0000-7000-8000-000000002205';
const OTHER_SECTION_ID = '018f0000-0000-7000-8000-000000002206';
const TASK_ID = '018f0000-0000-7000-8000-000000002207';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000002208';
const REPORT_ID = '018f0000-0000-7000-8000-000000002209';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function eventId(index: number): string {
  return `018f0000-0000-7000-8000-${String(2300 + index).padStart(12, '0')}`;
}

describePostgres('PostgresSyncEventReader', () => {
  let client: Client;
  let reader: PostgresSyncEventReader;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    reader = new PostgresSyncEventReader(client);
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_event_retention, sync_events,
        followed_class_sections, class_sections, courses, academic_terms,
        users cascade
    `);
    await client.query(
      `insert into users (
         id, username, username_key, display_name, status, profile_revision
       ) values
         ($1, 'student', 'student', 'Student', 'active', 1),
         ($2, 'other', 'other', 'Other', 'active', 1)`,
      [USER_ID, OTHER_USER_ID],
    );
    await client.query(
      `insert into academic_terms (id, external_term_code, name)
       values ($1, 'term', 'Term')`,
      [TERM_ID],
    );
    await client.query(
      `insert into courses (id, term_id, external_course_code, name)
       values ($1, $2, 'course', 'Course')`,
      [COURSE_ID, TERM_ID],
    );
    await client.query(
      `insert into class_sections (
         id, course_id, external_section_id, section_number
       ) values
         ($1, $3, 'section-1', '01'),
         ($2, $3, 'section-2', '02')`,
      [SECTION_ID, OTHER_SECTION_ID, COURSE_ID],
    );
    await client.query(
      `insert into followed_class_sections (user_id, class_section_id)
       values ($1, $2)`,
      [USER_ID, SECTION_ID],
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it('filters scopes, paginates visible events, and advances across invisible sequences', async () => {
    const definitions = [
      {
        scope: 'private_user',
        scopeUserId: OTHER_USER_ID,
        classSectionId: null,
        type: 'personal_todo_upserted',
        payload: {
          id: eventId(20),
          class_section_id: null,
          title: 'Invisible todo',
          deadline: null,
          note: null,
          state: 'pending',
          revision: 1,
          deleted_at: null,
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        },
      },
      {
        scope: 'class_section_public',
        scopeUserId: null,
        classSectionId: SECTION_ID,
        type: 'course_task_created',
        payload: {
          id: TASK_ID,
          class_section_id: SECTION_ID,
          created_by: USER_ID,
          state: 'visible',
          revision: 1,
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        },
      },
      {
        scope: 'authenticated_global',
        scopeUserId: null,
        classSectionId: null,
        type: 'public_user_profile_updated',
        payload: {
          id: USER_ID,
          username: 'student',
          display_name: 'Student',
          avatar_url: null,
          bio: null,
          status: 'active',
          revision: 1,
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        },
      },
      {
        scope: 'maintainer_private',
        scopeUserId: null,
        classSectionId: null,
        type: 'maintainer_content_report_updated',
        payload: {
          report_id: REPORT_ID,
          reporter_id: OTHER_USER_ID,
          target_type: 'course_task',
          target_id: TASK_ID,
          reason: 'inaccurate',
          details: null,
          status: 'open',
          resolution: null,
          created_at: NOW.toISOString(),
          resolved_at: null,
        },
      },
      {
        scope: 'private_user',
        scopeUserId: USER_ID,
        classSectionId: null,
        type: 'personal_task_state_upserted',
        payload: {
          course_task_id: TASK_ID,
          state: 'completed',
          revision: 2,
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        },
      },
      {
        scope: 'class_section_public',
        scopeUserId: null,
        classSectionId: OTHER_SECTION_ID,
        type: 'task_proposal_created',
        payload: {
          id: PROPOSAL_ID,
          course_task_id: TASK_ID,
          author_id: USER_ID,
          title: 'Invisible proposal',
          deadline: NOW.toISOString(),
          description: null,
          evidence_note: null,
          evidence_url: null,
          content_fingerprint: 'a'.repeat(64),
          state: 'visible',
          revision: 1,
          created_at: NOW.toISOString(),
        },
      },
    ] as const;
    for (const [index, definition] of definitions.entries()) {
      await client.query(
        `insert into sync_events (
           event_id, scope, scope_user_id, class_section_id, type,
           schema_version, payload, occurred_at
         ) values ($1, $2, $3, $4, $5, 2, $6::jsonb, $7)`,
        [
          eventId(index),
          definition.scope,
          definition.scopeUserId,
          definition.classSectionId,
          definition.type,
          JSON.stringify(definition.payload),
          NOW,
        ],
      );
    }

    const bounds = await client.query<{ minimum: string; maximum: string }>(
      `select min(sequence)::text as minimum,
              max(sequence)::text as maximum
       from sync_events`,
    );
    const minimumSequence = Number(bounds.rows[0]?.minimum);
    const maximumSequence = Number(bounds.rows[0]?.maximum);

    const first = await reader.pull({
      userId: USER_ID,
      maintainer: false,
      afterSequence: 0,
      limit: 2,
    });
    expect(first.events.map(({ type }) => type)).toEqual([
      'course_task_created',
      'public_user_profile_updated',
    ]);
    expect(first.hasMore).toBe(true);
    expect(first.nextSequence).toBe(minimumSequence + 2);

    const second = await reader.pull({
      userId: USER_ID,
      maintainer: false,
      afterSequence: first.nextSequence,
      limit: 2,
    });
    expect(second.events.map(({ type }) => type)).toEqual([
      'personal_task_state_upserted',
    ]);
    expect(second.hasMore).toBe(false);
    expect(second.nextSequence).toBe(maximumSequence);
  });

  it('includes maintainer-private events only for maintainers', async () => {
    await client.query(
      `insert into sync_events (
         event_id, scope, type, schema_version, payload, occurred_at
       ) values ($1, 'maintainer_private',
                 'maintainer_content_report_updated', 2, $2::jsonb, $3)`,
      [
        eventId(0),
        JSON.stringify({
          report_id: REPORT_ID,
          reporter_id: OTHER_USER_ID,
          target_type: 'course_task',
          target_id: TASK_ID,
          reason: 'inaccurate',
          details: null,
          status: 'open',
          resolution: null,
          created_at: NOW.toISOString(),
          resolved_at: null,
        }),
        NOW,
      ],
    );

    await expect(
      reader.pull({
        userId: USER_ID,
        maintainer: false,
        afterSequence: 0,
        limit: 10,
      }),
    ).resolves.toMatchObject({ events: [] });
    await expect(
      reader.pull({
        userId: USER_ID,
        maintainer: true,
        afterSequence: 0,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [{ type: 'maintainer_content_report_updated' }],
    });
  });

  it('requires a fresh snapshot before returning visible legacy events', async () => {
    await client.query(
      `insert into sync_events (
         event_id, scope, scope_user_id, type, schema_version, payload,
         occurred_at
       ) values ($1, 'private_user', $2, 'personal_todo_upserted',
                 1, '{}'::jsonb, $3)`,
      [eventId(0), USER_ID, NOW],
    );
    const sequence = await client.query<{ sequence: string }>(
      'select sequence::text from sync_events where event_id = $1',
      [eventId(0)],
    );

    const error = await reader
      .pull({
        userId: USER_ID,
        maintainer: false,
        afterSequence: 0,
        limit: 10,
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(SyncCursorExpiredError);
    expect(error).toMatchObject({
      minimumSequence: Number(sequence.rows[0]?.sequence),
    });
  });

  it('rejects cursors below the explicit retention watermark', async () => {
    await client.query(
      `insert into sync_event_retention (
         singleton_id, minimum_sequence
       ) values (1, 10)`,
    );

    const error = await reader
      .pull({
        userId: USER_ID,
        maintainer: false,
        afterSequence: 9,
        limit: 10,
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(SyncCursorExpiredError);
    expect(error).toMatchObject({ minimumSequence: 10 });
    await expect(
      reader.pull({
        userId: USER_ID,
        maintainer: false,
        afterSequence: 10,
        limit: 10,
      }),
    ).resolves.toMatchObject({ events: [], nextSequence: 10 });
  });
});
