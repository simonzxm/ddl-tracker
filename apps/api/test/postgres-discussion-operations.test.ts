import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import { PostgresStudentOperationExecutor } from '../src/sync/postgres-operation-executor.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000001901';
const OTHER_USER_ID = '018f0000-0000-7000-8000-000000001902';
const TERM_ID = '018f0000-0000-7000-8000-000000001903';
const COURSE_ID = '018f0000-0000-7000-8000-000000001904';
const SECTION_ID = '018f0000-0000-7000-8000-000000001905';
const TASK_ID = '018f0000-0000-7000-8000-000000001906';
const COMMENT_ID = '018f0000-0000-7000-8000-000000001907';
const REPORT_ID = '018f0000-0000-7000-8000-000000001908';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function operation(
  type: OperationEnvelope['type'],
  payload: Record<string, unknown>,
): OperationEnvelope {
  return {
    operation_id: '018f0000-0000-7000-8000-000000001909',
    type,
    schema_version: 1,
    depends_on: [],
    payload,
  } as unknown as OperationEnvelope;
}

function ids(): () => string {
  let value = 1000;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

describePostgres('PostgresStudentOperationExecutor discussion operations', () => {
  let client: Client;
  let executor: PostgresStudentOperationExecutor;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_events, content_reports, comment_revisions,
        task_comments, course_tasks, class_sections, courses, academic_terms,
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
      `insert into academic_terms (
         id, external_term_code, name, starts_on, ends_on
       ) values ($1, 'term', 'Term', '2026-01-01', '2026-12-31')`,
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
       ) values ($1, $2, 'section', '01')`,
      [SECTION_ID, COURSE_ID],
    );
    await client.query(
      `insert into course_tasks (id, class_section_id, created_by)
       values ($1, $2, $3)`,
      [TASK_ID, SECTION_ID, USER_ID],
    );
    executor = new PostgresStudentOperationExecutor(client, {
      now: () => NOW,
      createId: ids(),
    });
  });

  afterAll(async () => {
    await client.end();
  });

  it('creates, edits, and tombstones a comment through immutable revisions', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('create_task_comment', {
          comment_id: COMMENT_ID,
          course_task_id: TASK_ID,
          body: 'First body',
        }),
      ),
    ).resolves.toMatchObject({ comment_id: COMMENT_ID, revision: 1 });

    await expect(
      executor.execute(
        USER_ID,
        operation('edit_task_comment', {
          comment_id: COMMENT_ID,
          expected_revision: 1,
          body: 'Edited body',
        }),
      ),
    ).resolves.toMatchObject({ revision: 2 });

    await expect(
      executor.execute(
        USER_ID,
        operation('delete_task_comment', {
          comment_id: COMMENT_ID,
          expected_revision: 2,
        }),
      ),
    ).resolves.toMatchObject({ revision: 3, deleted: true });

    const revisions = await client.query<{ revision: number; body: string }>(
      `select revision, body from comment_revisions
       where comment_id = $1 order by revision`,
      [COMMENT_ID],
    );
    expect(revisions.rows).toEqual([
      { revision: 1, body: 'First body' },
      { revision: 2, body: 'Edited body' },
    ]);
    const comment = await client.query<{
      current_revision: number;
      deleted_at: Date | null;
    }>(
      `select current_revision, deleted_at from task_comments where id = $1`,
      [COMMENT_ID],
    );
    expect(comment.rows[0]?.current_revision).toBe(3);
    expect(comment.rows[0]?.deleted_at).not.toBeNull();

    const events = await client.query<{ scope: string; type: string }>(
      'select scope, type from sync_events order by sequence',
    );
    expect(events.rows).toEqual([
      { scope: 'class_section_public', type: 'task_comment_upserted' },
      { scope: 'class_section_public', type: 'task_comment_upserted' },
      { scope: 'class_section_public', type: 'task_comment_deleted' },
    ]);
  });

  it('requires comment ownership and current revision for edits', async () => {
    await executor.execute(
      USER_ID,
      operation('create_task_comment', {
        comment_id: COMMENT_ID,
        course_task_id: TASK_ID,
        body: 'Body',
      }),
    );

    await expect(
      executor.execute(
        OTHER_USER_ID,
        operation('edit_task_comment', {
          comment_id: COMMENT_ID,
          expected_revision: 1,
          body: 'Not mine',
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executor.execute(
        USER_ID,
        operation('edit_task_comment', {
          comment_id: COMMENT_ID,
          expected_revision: 9,
          body: 'Stale',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      details: { current_revision: 1 },
    });
  });

  it('creates complete private report state and a maintainer-only notification', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('create_content_report', {
          report_id: REPORT_ID,
          target_type: 'course_task',
          target_id: TASK_ID,
          reason: 'inaccurate',
          details: 'Deadline is wrong',
        }),
      ),
    ).resolves.toMatchObject({ report_id: REPORT_ID, status: 'open' });

    const report = await client.query<{
      reporter_id: string;
      target_type: string;
      target_id: string;
      status: string;
    }>('select reporter_id, target_type, target_id, status from content_reports');
    expect(report.rows[0]).toEqual({
      reporter_id: USER_ID,
      target_type: 'course_task',
      target_id: TASK_ID,
      status: 'open',
    });

    const events = await client.query<{
      scope: string;
      scope_user_id: string | null;
      type: string;
      payload: Record<string, unknown>;
    }>(
      `select scope, scope_user_id, type, payload from sync_events
       where type in (
         'reporter_content_report_updated',
         'maintainer_content_report_updated'
       )
       order by sequence`,
    );
    expect(events.rows.map(({ scope, type }) => ({ scope, type }))).toEqual([
      {
        scope: 'private_user',
        type: 'reporter_content_report_updated',
      },
      {
        scope: 'maintainer_private',
        type: 'maintainer_content_report_updated',
      },
    ]);
    expect(events.rows[0]?.scope_user_id).toBe(USER_ID);
    expect(events.rows[0]?.payload).not.toHaveProperty('reporter_id');
    expect(events.rows[0]?.payload).toMatchObject({
      report_id: REPORT_ID,
      target_type: 'course_task',
      target_id: TASK_ID,
      reason: 'inaccurate',
      details: 'Deadline is wrong',
      status: 'open',
      resolution: null,
      resolved_at: null,
    });
    expect(events.rows[1]?.payload).toMatchObject({
      reporter_id: USER_ID,
      details: 'Deadline is wrong',
    });
  });

  it('rejects reports for missing targets without creating private records', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('create_content_report', {
          report_id: REPORT_ID,
          target_type: 'comment',
          target_id: COMMENT_ID,
          reason: 'spam',
          details: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const count = await client.query<{ count: string }>(
      'select count(*)::text as count from content_reports',
    );
    expect(count.rows[0]?.count).toBe('0');
  });
});
