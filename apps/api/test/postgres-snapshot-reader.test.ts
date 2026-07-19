import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresSnapshotReader } from '../src/sync/postgres-snapshot-reader.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000002601';
const OTHER_USER_ID = '018f0000-0000-7000-8000-000000002602';
const TERM_ID = '018f0000-0000-7000-8000-000000002603';
const COURSE_ID = '018f0000-0000-7000-8000-000000002604';
const SECTION_ID = '018f0000-0000-7000-8000-000000002605';
const OTHER_SECTION_ID = '018f0000-0000-7000-8000-000000002606';
const TASK_ID = '018f0000-0000-7000-8000-000000002607';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000002608';
const TODO_ID = '018f0000-0000-7000-8000-000000002609';
const COMMENT_ID = '018f0000-0000-7000-8000-000000002610';

async function seed(client: Client): Promise<void> {
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
  await client.query(
    `insert into course_tasks (id, class_section_id, created_by)
     values ($1, $2, $3)`,
    [TASK_ID, SECTION_ID, OTHER_USER_ID],
  );
  await client.query(
    `insert into task_proposals (
       id, task_id, author_id, title, deadline, content_fingerprint
     ) values ($1, $2, $3, 'Task title', '2026-07-20T12:00:00Z', $4)`,
    [PROPOSAL_ID, TASK_ID, OTHER_USER_ID, 'a'.repeat(64)],
  );
  await client.query(
    `insert into proposal_vote_totals (proposal_id, up, down)
     values ($1, 2, 1)`,
    [PROPOSAL_ID],
  );
  await client.query(
    `insert into accuracy_votes (user_id, proposal_id, direction)
     values ($1, $2, 'up')`,
    [USER_ID, PROPOSAL_ID],
  );
  await client.query(
    `insert into personal_todos (id, user_id, title)
     values
       ($1, $2, 'Mine'),
       ('018f0000-0000-7000-8000-000000002699', $3, 'Other private')`,
    [TODO_ID, USER_ID, OTHER_USER_ID],
  );
  await client.query(
    `insert into personal_task_details (user_id, task_id, private_title)
     values ($1, $2, 'My private title')`,
    [USER_ID, TASK_ID],
  );
  await client.query(
    `insert into personal_task_states (user_id, task_id, state)
     values ($1, $2, 'completed')`,
    [USER_ID, TASK_ID],
  );
  await client.query(
    `insert into task_comments (
       id, task_id, author_id, current_revision
     ) values ($1, $2, $3, 1)`,
    [COMMENT_ID, TASK_ID, OTHER_USER_ID],
  );
  await client.query(
    `insert into comment_revisions (
       comment_id, revision, body, author_id
     ) values ($1, 1, 'Comment body', $2)`,
    [COMMENT_ID, OTHER_USER_ID],
  );
  await client.query(
    `insert into sync_events (
       event_id, scope, type, schema_version, payload
     ) values
       ('018f0000-0000-7000-8000-000000002620',
        'authenticated_global', 'public_user_profile_updated', 1, '{}'::jsonb),
       ('018f0000-0000-7000-8000-000000002621',
        'authenticated_global', 'public_user_profile_updated', 1, '{}'::jsonb)`,
  );
}

describePostgres('PostgresSnapshotReader', () => {
  let client: Client;
  let reader: PostgresSnapshotReader;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    reader = new PostgresSnapshotReader(client);
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_events, comment_revisions, task_comments,
        personal_task_states, personal_task_details, personal_todos,
        accuracy_votes, proposal_vote_totals, task_proposals, course_tasks,
        followed_class_sections, class_sections, courses, academic_terms,
        users restart identity cascade
    `);
    await seed(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('captures the current global event anchor', async () => {
    await expect(reader.readAnchor()).resolves.toBe(2);
  });

  it('returns account-private and followed-section records without other private data', async () => {
    const page = await reader.readAccountPage({
      userId: USER_ID,
      after: null,
      limit: 100,
    });

    const types = page.records.map(({ record_type }) => record_type);
    expect(types).toContain('public_user_profile');
    expect(types).toContain('followed_class_section');
    expect(types).toContain('personal_todo');
    expect(types).toContain('personal_task_details');
    expect(types).toContain('personal_task_state');
    expect(types).toContain('course_task');
    expect(types).toContain('task_proposal');
    expect(types).toContain('proposal_vote_totals');
    expect(types).toContain('accuracy_vote');
    expect(types).toContain('task_comment');
    expect(JSON.stringify(page.records)).not.toContain('Other private');
    expect(JSON.stringify(page.records)).not.toContain('raw_source');
    expect(page.complete).toBe(true);
  });

  it('uses a stable record key to resume account pagination', async () => {
    const first = await reader.readAccountPage({
      userId: USER_ID,
      after: null,
      limit: 3,
    });
    expect(first.complete).toBe(false);
    expect(first.nextAfter).not.toBeNull();

    const second = await reader.readAccountPage({
      userId: USER_ID,
      after: first.nextAfter,
      limit: 100,
    });
    const firstKeys = first.records.map(
      ({ record_type, id }) => `${record_type}:${id}`,
    );
    const secondKeys = second.records.map(
      ({ record_type, id }) => `${record_type}:${id}`,
    );
    expect(secondKeys.some((key) => firstKeys.includes(key))).toBe(false);
    expect(second.complete).toBe(true);
  });

  it('returns a class section snapshot without creating a follow relationship', async () => {
    await client.query(
      'delete from followed_class_sections where user_id = $1',
      [USER_ID],
    );

    const page = await reader.readClassSectionPage({
      userId: USER_ID,
      classSectionId: SECTION_ID,
      after: null,
      limit: 100,
    });

    expect(page.records.map(({ record_type }) => record_type)).toEqual(
      expect.arrayContaining([
        'class_section',
        'course_task',
        'task_proposal',
        'proposal_vote_totals',
        'accuracy_vote',
        'personal_task_details',
        'personal_task_state',
        'task_comment',
      ]),
    );
    const follows = await client.query<{ count: string }>(
      'select count(*)::text as count from followed_class_sections',
    );
    expect(follows.rows[0]?.count).toBe('0');
  });

  it('rejects a missing or inactive class section snapshot', async () => {
    await client.query('update class_sections set active = false where id = $1', [
      SECTION_ID,
    ]);
    await expect(
      reader.readClassSectionPage({
        userId: USER_ID,
        classSectionId: SECTION_ID,
        after: null,
        limit: 100,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
