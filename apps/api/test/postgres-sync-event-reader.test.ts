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
      ['private_user', OTHER_USER_ID, null, 'personal_todo_upserted'],
      ['class_section_public', null, SECTION_ID, 'course_task_created'],
      ['authenticated_global', null, null, 'public_user_profile_updated'],
      ['maintainer_private', null, null, 'content_report_status_updated'],
      ['private_user', USER_ID, null, 'personal_task_state_upserted'],
      ['class_section_public', null, OTHER_SECTION_ID, 'task_proposal_created'],
    ] as const;
    for (const [index, definition] of definitions.entries()) {
      await client.query(
        `insert into sync_events (
           event_id, scope, scope_user_id, class_section_id, type,
           schema_version, payload
         ) values ($1, $2, $3, $4, $5, 1, $6::jsonb)`,
        [eventId(index), ...definition.slice(0, 3), definition[3], JSON.stringify({ index })],
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
         event_id, scope, type, schema_version, payload
       ) values ($1, 'maintainer_private', 'content_report_status_updated',
                 1, '{}'::jsonb)`,
      [eventId(0)],
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
      events: [{ type: 'content_report_status_updated' }],
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
