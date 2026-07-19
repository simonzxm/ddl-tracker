import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import { SyncOperationRejection } from '../src/sync/batch-service.js';
import { PostgresStudentOperationExecutor } from '../src/sync/postgres-operation-executor.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000001601';
const TERM_ID = '018f0000-0000-7000-8000-000000001602';
const COURSE_ID = '018f0000-0000-7000-8000-000000001603';
const SECTION_ID = '018f0000-0000-7000-8000-000000001604';
const TODO_ID = '018f0000-0000-7000-8000-000000001605';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function operation(
  type: OperationEnvelope['type'],
  payload: Record<string, unknown>,
): OperationEnvelope {
  return {
    operation_id: '018f0000-0000-7000-8000-000000001606',
    type,
    schema_version: 1,
    depends_on: [],
    payload,
  } as unknown as OperationEnvelope;
}

function ids(): () => string {
  let value = 700;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

describePostgres('PostgresStudentOperationExecutor private basics', () => {
  let client: Client;
  let executor: PostgresStudentOperationExecutor;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_events, personal_todos, followed_class_sections,
        class_sections, courses, academic_terms, users cascade
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
    executor = new PostgresStudentOperationExecutor(client, {
      now: () => NOW,
      createId: ids(),
    });
  });

  afterAll(async () => {
    await client.end();
  });

  it('follows and unfollows a class section idempotently', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('follow_class_section', { class_section_id: SECTION_ID }),
      ),
    ).resolves.toMatchObject({ class_section_id: SECTION_ID, followed: true });
    await executor.execute(
      USER_ID,
      operation('follow_class_section', { class_section_id: SECTION_ID }),
    );
    await expect(
      executor.execute(
        USER_ID,
        operation('unfollow_class_section', { class_section_id: SECTION_ID }),
      ),
    ).resolves.toMatchObject({ class_section_id: SECTION_ID, followed: false });

    const events = await client.query<{ type: string }>(
      'select type from sync_events order by sequence',
    );
    expect(events.rows).toEqual([
      { type: 'class_section_followed' },
      { type: 'class_section_unfollowed' },
    ]);
  });

  it('creates, updates, and tombstones a personal todo with monotonic revisions', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('create_personal_todo', {
          personal_todo_id: TODO_ID,
          class_section_id: SECTION_ID,
          title: 'Read chapter',
          deadline: '2026-07-20T12:00:00.000Z',
          note: 'Private note',
          state: 'pending',
        }),
      ),
    ).resolves.toMatchObject({ personal_todo_id: TODO_ID, revision: 1 });

    await expect(
      executor.execute(
        USER_ID,
        operation('update_personal_todo', {
          personal_todo_id: TODO_ID,
          expected_revision: 1,
          class_section_id: null,
          title: 'Read two chapters',
          deadline: null,
          note: null,
          state: 'completed',
        }),
      ),
    ).resolves.toMatchObject({ revision: 2 });

    await expect(
      executor.execute(
        USER_ID,
        operation('delete_personal_todo', {
          personal_todo_id: TODO_ID,
          expected_revision: 2,
        }),
      ),
    ).resolves.toMatchObject({ revision: 3, deleted: true });

    const row = await client.query<{
      title: string;
      state: string;
      revision: number;
      deleted_at: Date | null;
    }>(
      `select title, state, revision, deleted_at
       from personal_todos where id = $1 and user_id = $2`,
      [TODO_ID, USER_ID],
    );
    expect(row.rows[0]).toMatchObject({
      title: 'Read two chapters',
      state: 'completed',
      revision: 3,
    });
    expect(row.rows[0]?.deleted_at).not.toBeNull();

    const events = await client.query<{ type: string; payload: unknown }>(
      'select type, payload from sync_events order by sequence',
    );
    expect(events.rows.map(({ type }) => type)).toEqual([
      'personal_todo_upserted',
      'personal_todo_upserted',
      'personal_todo_deleted',
    ]);
  });

  it('rejects a stale personal todo revision and returns current state', async () => {
    await executor.execute(
      USER_ID,
      operation('create_personal_todo', {
        personal_todo_id: TODO_ID,
        class_section_id: null,
        title: 'Todo',
        deadline: null,
        note: null,
        state: 'pending',
      }),
    );

    const rejection = await executor
      .execute(
        USER_ID,
        operation('update_personal_todo', {
          personal_todo_id: TODO_ID,
          expected_revision: 9,
          class_section_id: null,
          title: 'Stale',
          deadline: null,
          note: null,
          state: 'pending',
        }),
      )
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(SyncOperationRejection);
    expect(rejection).toMatchObject({
      code: 'revision_conflict',
      details: { current_revision: 1 },
    });
  });

  it('rejects foreign or missing personal todo IDs without leaking ownership', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('delete_personal_todo', {
          personal_todo_id: TODO_ID,
          expected_revision: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
