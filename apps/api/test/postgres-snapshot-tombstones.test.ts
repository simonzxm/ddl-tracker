import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresSnapshotReader } from '../src/sync/postgres-snapshot-reader.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000003801';
const TERM_ID = '018f0000-0000-7000-8000-000000003802';
const COURSE_ID = '018f0000-0000-7000-8000-000000003803';
const SECTION_ID = '018f0000-0000-7000-8000-000000003804';
const VISIBLE_TASK = '018f0000-0000-7000-8000-000000003805';
const HIDDEN_TASK = '018f0000-0000-7000-8000-000000003806';
const MERGED_TASK = '018f0000-0000-7000-8000-000000003807';
const VISIBLE_PROPOSAL = '018f0000-0000-7000-8000-000000003808';
const HIDDEN_PROPOSAL = '018f0000-0000-7000-8000-000000003809';
const REDIRECTED_PROPOSAL = '018f0000-0000-7000-8000-000000003810';
const VISIBLE_COMMENT = '018f0000-0000-7000-8000-000000003811';
const HIDDEN_COMMENT = '018f0000-0000-7000-8000-000000003812';
const DELETED_COMMENT = '018f0000-0000-7000-8000-000000003813';

async function seed(client: Client): Promise<void> {
  await client.query(
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values ($1, 'snapshot-user', 'snapshot_user', 'Snapshot', 'active', 1)`,
    [USER_ID],
  );
  await client.query(
    `insert into academic_terms (id, external_term_code, name)
     values ($1, 'term-snapshot-tombstone', 'Term')`,
    [TERM_ID],
  );
  await client.query(
    `insert into courses (id, term_id, external_course_code, name)
     values ($1, $2, 'course-snapshot-tombstone', 'Course')`,
    [COURSE_ID, TERM_ID],
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number
     ) values ($1, $2, 'section-snapshot-tombstone', '01')`,
    [SECTION_ID, COURSE_ID],
  );
  await client.query(
    `insert into course_tasks (
       id, class_section_id, created_by, state, revision
     ) values
       ($1, $4, $5, 'visible', 1),
       ($2, $4, $5, 'hidden', 2),
       ($3, $4, $5, 'merged', 3)`,
    [VISIBLE_TASK, HIDDEN_TASK, MERGED_TASK, SECTION_ID, USER_ID],
  );
  await client.query(
    `insert into task_merges (
       source_task_id, target_task_id, maintainer_id, reason
     ) values ($1, $2, $3, 'Duplicate')`,
    [MERGED_TASK, VISIBLE_TASK, USER_ID],
  );
  await client.query(
    `insert into task_proposals (
       id, task_id, author_id, title, deadline, content_fingerprint,
       state, revision
     ) values
       ($1, $4, $6, 'Visible proposal', '2026-07-20T12:00:00Z', $7,
        'visible', 1),
       ($2, $4, $6, 'Hidden proposal secret', '2026-07-21T12:00:00Z', $8,
        'hidden', 2),
       ($3, $5, $6, 'Redirected proposal secret', '2026-07-20T12:00:00Z', $7,
        'redirected', 2)`,
    [
      VISIBLE_PROPOSAL,
      HIDDEN_PROPOSAL,
      REDIRECTED_PROPOSAL,
      VISIBLE_TASK,
      MERGED_TASK,
      USER_ID,
      'e'.repeat(64),
      'f'.repeat(64),
    ],
  );
  await client.query(
    `insert into proposal_redirects (
       source_proposal_id, canonical_proposal_id
     ) values ($1, $2)`,
    [REDIRECTED_PROPOSAL, VISIBLE_PROPOSAL],
  );
  await client.query(
    `insert into proposal_vote_totals (proposal_id, up, down) values
       ($1, 1, 0), ($2, 8, 3), ($3, 0, 0)`,
    [VISIBLE_PROPOSAL, HIDDEN_PROPOSAL, REDIRECTED_PROPOSAL],
  );
  await client.query(
    `insert into task_comments (
       id, task_id, author_id, state, current_revision, deleted_at
     ) values
       ($1, $4, $5, 'visible', 1, null),
       ($2, $4, $5, 'hidden', 1, null),
       ($3, $4, $5, 'visible', 2, '2026-07-19T12:00:00Z')`,
    [VISIBLE_COMMENT, HIDDEN_COMMENT, DELETED_COMMENT, VISIBLE_TASK, USER_ID],
  );
  await client.query(
    `insert into comment_revisions (comment_id, revision, body, author_id) values
       ($1, 1, 'Visible body', $4),
       ($2, 1, 'Hidden body secret', $4),
       ($3, 1, 'Deleted body secret', $4),
       ($3, 2, 'Deleted body latest secret', $4)`,
    [VISIBLE_COMMENT, HIDDEN_COMMENT, DELETED_COMMENT, USER_ID],
  );
}

describePostgres('PostgresSnapshotReader tombstones', () => {
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
        proposal_vote_totals, accuracy_votes, proposal_redirects,
        task_merges, task_proposals, course_tasks, followed_class_sections,
        class_sections, courses, academic_terms, users restart identity cascade
    `);
    await seed(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('emits tombstones and redirects without hidden body leakage', async () => {
    const page = await reader.readClassSectionPage({
      userId: USER_ID,
      classSectionId: SECTION_ID,
      after: null,
      limit: 100,
    });
    const fullTasks = page.records.filter(
      ({ record_type }) => record_type === 'course_task',
    );
    expect(fullTasks.map(({ id }) => id)).toEqual([VISIBLE_TASK]);

    const tombstones = page.records.filter(
      ({ record_type }) => record_type === 'content_tombstone',
    );
    expect(tombstones.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        HIDDEN_TASK,
        HIDDEN_PROPOSAL,
        HIDDEN_COMMENT,
        DELETED_COMMENT,
      ]),
    );
    expect(page.records).toContainEqual(
      expect.objectContaining({
        record_type: 'task_merge',
        id: MERGED_TASK,
        payload: expect.objectContaining({ target_task_id: VISIBLE_TASK }),
      }),
    );
    expect(page.records).toContainEqual(
      expect.objectContaining({
        record_type: 'proposal_redirect',
        id: REDIRECTED_PROPOSAL,
        payload: expect.objectContaining({
          canonical_proposal_id: VISIBLE_PROPOSAL,
        }),
      }),
    );

    const serialized = JSON.stringify(page.records);
    expect(serialized).not.toContain('Hidden proposal secret');
    expect(serialized).not.toContain('Redirected proposal secret');
    expect(serialized).not.toContain('Hidden body secret');
    expect(serialized).not.toContain('Deleted body');

    const totalIds = page.records
      .filter(({ record_type }) => record_type === 'proposal_vote_totals')
      .map(({ id }) => id);
    expect(totalIds).toEqual([VISIBLE_PROPOSAL]);
  });
});
