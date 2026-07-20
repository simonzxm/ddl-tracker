import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import { PostgresStudentOperationExecutor } from '../src/sync/postgres-operation-executor.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000001701';
const TERM_ID = '018f0000-0000-7000-8000-000000001702';
const COURSE_ID = '018f0000-0000-7000-8000-000000001703';
const SECTION_ID = '018f0000-0000-7000-8000-000000001704';
const TASK_ID = '018f0000-0000-7000-8000-000000001705';
const TODO_ID = '018f0000-0000-7000-8000-000000001706';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function operation(
  type: OperationEnvelope['type'],
  payload: Record<string, unknown>,
): OperationEnvelope {
  return {
    operation_id: '018f0000-0000-7000-8000-000000001707',
    type,
    schema_version: 1,
    depends_on: [],
    payload,
  } as unknown as OperationEnvelope;
}

function ids(): () => string {
  let value = 800;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

describePostgres('PostgresStudentOperationExecutor private task data', () => {
  let client: Client;
  let executor: PostgresStudentOperationExecutor;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_events, personal_task_states, personal_task_details,
        personal_todos, course_tasks, class_sections, courses, academic_terms,
        users cascade
    `);
    await client.query(
      `insert into users (
         id, username, username_key, display_name, status, profile_revision
       ) values ($1, 'student', 'student', 'Student', 'active', 1)`,
      [USER_ID],
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

  it('upserts and deletes personal task details using revision zero for create', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('upsert_personal_task_details', {
          course_task_id: TASK_ID,
          private_title: 'Private title',
          private_deadline: '2026-07-20T12:00:00.000Z',
          private_note: 'Private note',
          expected_revision: 0,
        }),
      ),
    ).resolves.toMatchObject({ course_task_id: TASK_ID, revision: 1 });

    await expect(
      executor.execute(
        USER_ID,
        operation('upsert_personal_task_details', {
          course_task_id: TASK_ID,
          private_title: 'Updated title',
          private_deadline: null,
          private_note: null,
          expected_revision: 1,
        }),
      ),
    ).resolves.toMatchObject({ revision: 2 });

    await expect(
      executor.execute(
        USER_ID,
        operation('delete_personal_task_details', {
          course_task_id: TASK_ID,
          expected_revision: 2,
        }),
      ),
    ).resolves.toMatchObject({ revision: 3, deleted: true });

    const count = await client.query<{ count: string }>(
      `select count(*)::text as count from personal_task_details
       where user_id = $1 and task_id = $2`,
      [USER_ID, TASK_ID],
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('creates and updates personal task state with optimistic revisions', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('set_personal_task_state', {
          course_task_id: TASK_ID,
          state: 'completed',
          expected_revision: 0,
        }),
      ),
    ).resolves.toMatchObject({ revision: 1, state: 'completed' });

    await expect(
      executor.execute(
        USER_ID,
        operation('set_personal_task_state', {
          course_task_id: TASK_ID,
          state: 'ignored',
          expected_revision: 1,
        }),
      ),
    ).resolves.toMatchObject({ revision: 2, state: 'ignored' });

    await expect(
      executor.execute(
        USER_ID,
        operation('set_personal_task_state', {
          course_task_id: TASK_ID,
          state: 'pending',
          expected_revision: 1,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      details: { current_revision: 2 },
    });
  });

  it('merges a personal todo into an existing task and transfers details and state', async () => {
    await client.query(
      `insert into personal_todos (
         id, user_id, class_section_id, title, deadline, note, state, revision
       ) values ($1, $2, $3, 'Todo title', $4, 'Todo note', 'completed', 1)`,
      [TODO_ID, USER_ID, SECTION_ID, '2026-07-20T12:00:00.000Z'],
    );

    await expect(
      executor.execute(
        USER_ID,
        operation('merge_personal_todo_into_course_task', {
          personal_todo_id: TODO_ID,
          course_task_id: TASK_ID,
          expected_personal_todo_revision: 1,
          expected_details_revision: 0,
          expected_state_revision: 0,
        }),
      ),
    ).resolves.toMatchObject({
      personal_todo_id: TODO_ID,
      course_task_id: TASK_ID,
      personal_todo_revision: 2,
    });

    const details = await client.query<{
      private_title: string | null;
      private_note: string | null;
      revision: number;
    }>(
      `select private_title, private_note, revision from personal_task_details
       where user_id = $1 and task_id = $2`,
      [USER_ID, TASK_ID],
    );
    expect(details.rows[0]).toEqual({
      private_title: 'Todo title',
      private_note: 'Todo note',
      revision: 1,
    });
    const state = await client.query<{ state: string; revision: number }>(
      `select state, revision from personal_task_states
       where user_id = $1 and task_id = $2`,
      [USER_ID, TASK_ID],
    );
    expect(state.rows[0]).toEqual({ state: 'completed', revision: 1 });
    const todo = await client.query<{ revision: number; deleted_at: Date | null }>(
      `select revision, deleted_at from personal_todos
       where id = $1 and user_id = $2`,
      [TODO_ID, USER_ID],
    );
    expect(todo.rows[0]?.revision).toBe(2);
    expect(todo.rows[0]?.deleted_at).not.toBeNull();
  });

  it('checks target detail and state revisions before merging a todo', async () => {
    await client.query(
      `insert into personal_todos (
         id, user_id, class_section_id, title, state, revision
       ) values ($1, $2, $3, 'Todo title', 'pending', 1)`,
      [TODO_ID, USER_ID, SECTION_ID],
    );
    await client.query(
      `insert into personal_task_details (
         user_id, task_id, private_title, revision
       ) values ($1, $2, 'Existing', 1)`,
      [USER_ID, TASK_ID],
    );
    await client.query(
      `insert into personal_task_states (user_id, task_id, state, revision)
       values ($1, $2, 'completed', 1)`,
      [USER_ID, TASK_ID],
    );

    await expect(
      executor.execute(
        USER_ID,
        operation('merge_personal_todo_into_course_task', {
          personal_todo_id: TODO_ID,
          course_task_id: TASK_ID,
          expected_personal_todo_revision: 1,
          expected_details_revision: 0,
          expected_state_revision: 1,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      details: { current_revision: 1 },
    });

    await expect(
      executor.execute(
        USER_ID,
        operation('merge_personal_todo_into_course_task', {
          personal_todo_id: TODO_ID,
          course_task_id: TASK_ID,
          expected_personal_todo_revision: 1,
          expected_details_revision: 1,
          expected_state_revision: 0,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      details: { current_revision: 1 },
    });

    const todo = await client.query<{ deleted_at: Date | null }>(
      'select deleted_at from personal_todos where id = $1',
      [TODO_ID],
    );
    expect(todo.rows[0]?.deleted_at).toBeNull();
  });

  it('emits complete private records and tombstones', async () => {
    await executor.execute(
      USER_ID,
      operation('set_personal_task_state', {
        course_task_id: TASK_ID,
        state: 'completed',
        expected_revision: 0,
      }),
    );
    await executor.execute(
      USER_ID,
      operation('upsert_personal_task_details', {
        course_task_id: TASK_ID,
        private_title: 'Private',
        private_deadline: null,
        private_note: null,
        expected_revision: 0,
      }),
    );
    await executor.execute(
      USER_ID,
      operation('delete_personal_task_details', {
        course_task_id: TASK_ID,
        expected_revision: 1,
      }),
    );

    const events = await client.query<{ type: string; payload: unknown }>(
      'select type, payload from sync_events order by sequence',
    );
    expect(events.rows.map(({ type }) => type)).toEqual([
      'personal_task_state_upserted',
      'personal_task_details_upserted',
      'personal_task_details_deleted',
    ]);
    expect(events.rows[0]?.payload).toMatchObject({
      course_task_id: TASK_ID,
      state: 'completed',
      revision: 1,
    });
  });
});
