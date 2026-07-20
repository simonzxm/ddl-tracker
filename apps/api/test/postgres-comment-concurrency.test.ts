import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import { SyncBatchService } from '../src/sync/batch-service.js';
import { PostgresSyncBatchRepository } from '../src/sync/postgres-batch-repository.js';
import { PostgresStudentOperationExecutor } from '../src/sync/postgres-operation-executor.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000005001';
const TERM_ID = '018f0000-0000-7000-8000-000000005002';
const COURSE_ID = '018f0000-0000-7000-8000-000000005003';
const SECTION_ID = '018f0000-0000-7000-8000-000000005004';
const TASK_ID = '018f0000-0000-7000-8000-000000005005';
const COMMENT_ID = '018f0000-0000-7000-8000-000000005006';
const OPERATION_1 = '018f0000-0000-7000-8000-000000005007';
const OPERATION_2 = '018f0000-0000-7000-8000-000000005008';
const EVENT_1 = '018f0000-0000-7000-8000-000000005009';
const EVENT_2 = '018f0000-0000-7000-8000-000000005010';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function editOperation(
  operationId: string,
  body: string,
): OperationEnvelope {
  return {
    operation_id: operationId,
    type: 'edit_task_comment',
    schema_version: 1,
    depends_on: [],
    payload: {
      comment_id: COMMENT_ID,
      expected_revision: 1,
      body,
    },
  } as OperationEnvelope;
}

function service(client: Client, eventId: string): SyncBatchService {
  const executor = new PostgresStudentOperationExecutor(client, {
    now: () => NOW,
    createId: () => eventId,
  });
  return new SyncBatchService({
    repository: new PostgresSyncBatchRepository(client, (userId, operation) =>
      executor.execute(userId, operation),
    ),
    now: () => NOW,
  });
}

describePostgres('concurrent comment revisions', () => {
  let setupClient: Client;
  let firstClient: Client;
  let secondClient: Client;

  beforeAll(async () => {
    setupClient = new Client({ connectionString: databaseUrl });
    firstClient = new Client({ connectionString: databaseUrl });
    secondClient = new Client({ connectionString: databaseUrl });
    await Promise.all([
      setupClient.connect(),
      firstClient.connect(),
      secondClient.connect(),
    ]);
  });

  beforeEach(async () => {
    await setupClient.query(`
      truncate table operation_receipts, sync_events, comment_revisions,
        task_comments, course_tasks, class_sections, courses, academic_terms,
        users restart identity cascade
    `);
    await setupClient.query(
      `insert into users (
         id, username, username_key, display_name, status, profile_revision
       ) values ($1, 'comment-owner', 'comment_owner', 'Comment Owner',
                 'active', 1)`,
      [USER_ID],
    );
    await setupClient.query(
      `insert into academic_terms (
         id, external_term_code, name, starts_on, ends_on
       ) values ($1, 'term-comment-concurrency', 'Term',
                 '2026-01-01', '2026-12-31')`,
      [TERM_ID],
    );
    await setupClient.query(
      `insert into courses (id, term_id, external_course_code, name)
       values ($1, $2, 'course-comment-concurrency', 'Course')`,
      [COURSE_ID, TERM_ID],
    );
    await setupClient.query(
      `insert into class_sections (
         id, course_id, external_section_id, section_number
       ) values ($1, $2, 'section-comment-concurrency', '01')`,
      [SECTION_ID, COURSE_ID],
    );
    await setupClient.query(
      `insert into course_tasks (id, class_section_id, created_by)
       values ($1, $2, $3)`,
      [TASK_ID, SECTION_ID, USER_ID],
    );
    await setupClient.query(
      `insert into task_comments (
         id, task_id, author_id, current_revision, state
       ) values ($1, $2, $3, 1, 'visible')`,
      [COMMENT_ID, TASK_ID, USER_ID],
    );
    await setupClient.query(
      `insert into comment_revisions (
         comment_id, revision, body, author_id
       ) values ($1, 1, 'Original', $2)`,
      [COMMENT_ID, USER_ID],
    );
  });

  afterAll(async () => {
    await Promise.all([
      setupClient.end(),
      firstClient.end(),
      secondClient.end(),
    ]);
  });

  it('applies one edit and rejects the other with a stable revision conflict', async () => {
    const results = await Promise.all([
      service(firstClient, EVENT_1).execute(USER_ID, [
        editOperation(OPERATION_1, 'First edit'),
      ]),
      service(secondClient, EVENT_2).execute(USER_ID, [
        editOperation(OPERATION_2, 'Second edit'),
      ]),
    ]);
    const flattened = results.flat();

    expect(flattened.filter(({ status }) => status === 'applied')).toHaveLength(1);
    expect(flattened.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({
        status: 'rejected',
        error: expect.objectContaining({
          code: 'revision_conflict',
          details: expect.objectContaining({ current_revision: 2 }),
        }),
      }),
    ]);

    const revisions = await setupClient.query<{
      revision: number;
      body: string;
    }>(
      `select revision, body
       from comment_revisions
       where comment_id = $1
       order by revision`,
      [COMMENT_ID],
    );
    expect(revisions.rows).toHaveLength(2);
    expect(revisions.rows[0]).toEqual({ revision: 1, body: 'Original' });
    expect(revisions.rows[1]?.revision).toBe(2);
    expect(['First edit', 'Second edit']).toContain(revisions.rows[1]?.body);

    const comment = await setupClient.query<{ current_revision: number }>(
      `select current_revision from task_comments where id = $1`,
      [COMMENT_ID],
    );
    expect(comment.rows[0]?.current_revision).toBe(2);
  });
});
