import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import { PostgresStudentOperationExecutor } from '../src/sync/postgres-operation-executor.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000002001';
const TERM_ID = '018f0000-0000-7000-8000-000000002002';
const COURSE_ID = '018f0000-0000-7000-8000-000000002003';
const SECTION_ID = '018f0000-0000-7000-8000-000000002004';
const TODO_ID = '018f0000-0000-7000-8000-000000002005';
const TASK_ID = '018f0000-0000-7000-8000-000000002006';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000002007';
const PROPOSAL_2_ID = '018f0000-0000-7000-8000-000000002008';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function operation(
  type: OperationEnvelope['type'],
  payload: Record<string, unknown>,
): OperationEnvelope {
  return {
    operation_id: '018f0000-0000-7000-8000-000000002009',
    type,
    schema_version: 1,
    depends_on: [],
    payload,
  } as unknown as OperationEnvelope;
}

function proposal(title: string) {
  return {
    title,
    deadline: '2026-07-21T12:00:00.000Z',
    description: 'Explicit public description',
    evidence_note: 'Explicit public evidence',
    evidence_url: null,
  };
}

function ids(): () => string {
  let value = 1100;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

describePostgres('PostgresStudentOperationExecutor publication operations', () => {
  let client: Client;
  let executor: PostgresStudentOperationExecutor;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_events, proposal_vote_totals, accuracy_votes,
        task_proposals, personal_task_states, personal_task_details,
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
    executor = new PostgresStudentOperationExecutor(client, {
      now: () => NOW,
      createId: ids(),
    });
  });

  afterAll(async () => {
    await client.end();
  });

  it('publishes a todo as a new task from explicit public fields and transfers private state', async () => {
    await client.query(
      `insert into personal_todos (
         id, user_id, class_section_id, title, deadline, note, state, revision
       ) values ($1, $2, $3, 'Private title', null, 'Private secret',
                 'completed', 1)`,
      [TODO_ID, USER_ID, SECTION_ID],
    );

    await expect(
      executor.execute(
        USER_ID,
        operation('publish_personal_todo_as_course_task', {
          personal_todo_id: TODO_ID,
          expected_personal_todo_revision: 1,
          course_task_id: TASK_ID,
          class_section_id: SECTION_ID,
          proposal_id: PROPOSAL_ID,
          proposal: proposal('Public title'),
        }),
      ),
    ).resolves.toMatchObject({
      personal_todo_id: TODO_ID,
      course_task_id: TASK_ID,
      proposal_id: PROPOSAL_ID,
    });

    const publicProposal = await client.query<{
      title: string;
      description: string | null;
    }>('select title, description from task_proposals where id = $1', [
      PROPOSAL_ID,
    ]);
    expect(publicProposal.rows[0]).toEqual({
      title: 'Public title',
      description: 'Explicit public description',
    });
    expect(JSON.stringify(publicProposal.rows[0])).not.toContain('Private secret');

    const details = await client.query<{
      private_title: string | null;
      private_note: string | null;
    }>(
      `select private_title, private_note from personal_task_details
       where user_id = $1 and task_id = $2`,
      [USER_ID, TASK_ID],
    );
    expect(details.rows[0]).toEqual({
      private_title: 'Private title',
      private_note: 'Private secret',
    });
    const todo = await client.query<{ deleted_at: Date | null }>(
      'select deleted_at from personal_todos where id = $1',
      [TODO_ID],
    );
    expect(todo.rows[0]?.deleted_at).not.toBeNull();
  });

  it('publishes private task details as a proposal without copying private text', async () => {
    await client.query(
      `insert into course_tasks (id, class_section_id, created_by)
       values ($1, $2, $3)`,
      [TASK_ID, SECTION_ID, USER_ID],
    );
    await client.query(
      `insert into personal_task_details (
         user_id, task_id, private_title, private_deadline, private_note,
         revision
       ) values ($1, $2, 'Private title', null, 'Private secret', 2)`,
      [USER_ID, TASK_ID],
    );

    await expect(
      executor.execute(
        USER_ID,
        operation('publish_personal_task_details_as_proposal', {
          course_task_id: TASK_ID,
          expected_details_revision: 2,
          proposal_id: PROPOSAL_2_ID,
          proposal: proposal('Explicit public title'),
        }),
      ),
    ).resolves.toMatchObject({
      course_task_id: TASK_ID,
      proposal_id: PROPOSAL_2_ID,
    });

    const proposalRow = await client.query<{
      title: string;
      description: string | null;
    }>('select title, description from task_proposals where id = $1', [
      PROPOSAL_2_ID,
    ]);
    expect(proposalRow.rows[0]).toEqual({
      title: 'Explicit public title',
      description: 'Explicit public description',
    });
    const privateRow = await client.query<{ revision: number }>(
      `select revision from personal_task_details
       where user_id = $1 and task_id = $2`,
      [USER_ID, TASK_ID],
    );
    expect(privateRow.rows[0]?.revision).toBe(2);
  });

  it('rejects publication when the source private revision is stale', async () => {
    await client.query(
      `insert into personal_todos (
         id, user_id, class_section_id, title, state, revision
       ) values ($1, $2, $3, 'Private', 'pending', 2)`,
      [TODO_ID, USER_ID, SECTION_ID],
    );

    await expect(
      executor.execute(
        USER_ID,
        operation('publish_personal_todo_as_course_task', {
          personal_todo_id: TODO_ID,
          expected_personal_todo_revision: 1,
          course_task_id: TASK_ID,
          class_section_id: SECTION_ID,
          proposal_id: PROPOSAL_ID,
          proposal: proposal('Public'),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      details: { current_revision: 2 },
    });
    const tasks = await client.query<{ count: string }>(
      'select count(*)::text as count from course_tasks',
    );
    expect(tasks.rows[0]?.count).toBe('0');
  });
});
