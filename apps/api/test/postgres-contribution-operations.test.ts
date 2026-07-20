import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import { PostgresStudentOperationExecutor } from '../src/sync/postgres-operation-executor.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000001801';
const TERM_ID = '018f0000-0000-7000-8000-000000001802';
const COURSE_ID = '018f0000-0000-7000-8000-000000001803';
const SECTION_ID = '018f0000-0000-7000-8000-000000001804';
const TASK_ID = '018f0000-0000-7000-8000-000000001805';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000001806';
const PROPOSAL_2_ID = '018f0000-0000-7000-8000-000000001807';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function operation(
  type: OperationEnvelope['type'],
  payload: Record<string, unknown>,
): OperationEnvelope {
  return {
    operation_id: '018f0000-0000-7000-8000-000000001808',
    type,
    schema_version: 1,
    depends_on: [],
    payload,
  } as unknown as OperationEnvelope;
}

function proposal(title = 'Assignment') {
  return {
    title,
    deadline: '2026-07-20T12:00:00.000Z',
    description: 'Read chapters 1-2',
    evidence_note: 'Published in the course portal',
    evidence_url: 'https://example.edu/tasks/1',
  };
}

function ids(): () => string {
  let value = 900;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

describePostgres('PostgresStudentOperationExecutor shared contributions', () => {
  let client: Client;
  let executor: PostgresStudentOperationExecutor;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_events, proposal_vote_totals, accuracy_votes,
        task_proposals, course_tasks, class_sections, courses, academic_terms,
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

  it('creates a task, immutable proposal, author up vote, aggregate, and events atomically', async () => {
    await expect(
      executor.execute(
        USER_ID,
        operation('create_course_task_with_initial_proposal', {
          course_task_id: TASK_ID,
          class_section_id: SECTION_ID,
          proposal_id: PROPOSAL_ID,
          proposal: proposal(),
        }),
      ),
    ).resolves.toMatchObject({
      course_task_id: TASK_ID,
      proposal_id: PROPOSAL_ID,
      vote: 'up',
    });

    const state = await client.query<{
      tasks: string;
      proposals: string;
      votes: string;
      up: number;
      down: number;
    }>(
      `select
         (select count(*) from course_tasks)::text as tasks,
         (select count(*) from task_proposals)::text as proposals,
         (select count(*) from accuracy_votes)::text as votes,
         (select up from proposal_vote_totals where proposal_id = $1) as up,
         (select down from proposal_vote_totals where proposal_id = $1) as down`,
      [PROPOSAL_ID],
    );
    expect(state.rows[0]).toEqual({
      tasks: '1',
      proposals: '1',
      votes: '1',
      up: 1,
      down: 0,
    });

    const events = await client.query<{ scope: string; type: string }>(
      'select scope, type from sync_events order by sequence',
    );
    expect(events.rows).toEqual([
      { scope: 'class_section_public', type: 'course_task_created' },
      { scope: 'class_section_public', type: 'task_proposal_created' },
      {
        scope: 'class_section_public',
        type: 'proposal_vote_totals_updated',
      },
      { scope: 'private_user', type: 'accuracy_vote_updated' },
    ]);
  });

  it('creates a distinct proposal without an automatic vote', async () => {
    await executor.execute(
      USER_ID,
      operation('create_course_task_with_initial_proposal', {
        course_task_id: TASK_ID,
        class_section_id: SECTION_ID,
        proposal_id: PROPOSAL_ID,
        proposal: proposal(),
      }),
    );

    await expect(
      executor.execute(
        USER_ID,
        operation('create_task_proposal', {
          course_task_id: TASK_ID,
          proposal_id: PROPOSAL_2_ID,
          proposal: proposal('Different title'),
        }),
      ),
    ).resolves.toMatchObject({
      course_task_id: TASK_ID,
      proposal_id: PROPOSAL_2_ID,
    });

    const totals = await client.query<{ up: number; down: number }>(
      'select up, down from proposal_vote_totals where proposal_id = $1',
      [PROPOSAL_2_ID],
    );
    expect(totals.rows[0]).toEqual({ up: 0, down: 0 });
  });

  it('rejects an exact duplicate proposal and preserves existing votes', async () => {
    await executor.execute(
      USER_ID,
      operation('create_course_task_with_initial_proposal', {
        course_task_id: TASK_ID,
        class_section_id: SECTION_ID,
        proposal_id: PROPOSAL_ID,
        proposal: proposal(),
      }),
    );

    await expect(
      executor.execute(
        USER_ID,
        operation('create_task_proposal', {
          course_task_id: TASK_ID,
          proposal_id: PROPOSAL_2_ID,
          proposal: proposal(),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'duplicate_proposal',
      details: { existing_proposal_id: PROPOSAL_ID },
    });

    const votes = await client.query<{ count: string }>(
      'select count(*)::text as count from accuracy_votes',
    );
    expect(votes.rows[0]?.count).toBe('1');
  });

  it('sets, changes, and withdraws the current user vote while recomputing totals', async () => {
    await executor.execute(
      USER_ID,
      operation('create_course_task_with_initial_proposal', {
        course_task_id: TASK_ID,
        class_section_id: SECTION_ID,
        proposal_id: PROPOSAL_ID,
        proposal: proposal(),
      }),
    );

    await executor.execute(
      USER_ID,
      operation('set_accuracy_vote', {
        proposal_id: PROPOSAL_ID,
        value: 'down',
      }),
    );
    let totals = await client.query<{ up: number; down: number }>(
      'select up, down from proposal_vote_totals where proposal_id = $1',
      [PROPOSAL_ID],
    );
    expect(totals.rows[0]).toEqual({ up: 0, down: 1 });

    await executor.execute(
      USER_ID,
      operation('set_accuracy_vote', {
        proposal_id: PROPOSAL_ID,
        value: 'none',
      }),
    );
    totals = await client.query<{ up: number; down: number }>(
      'select up, down from proposal_vote_totals where proposal_id = $1',
      [PROPOSAL_ID],
    );
    expect(totals.rows[0]).toEqual({ up: 0, down: 0 });
  });

  it('rejects shared writes to archived terms and hidden tasks', async () => {
    await client.query(
      `update academic_terms set status_override = 'archived' where id = $1`,
      [TERM_ID],
    );
    await expect(
      executor.execute(
        USER_ID,
        operation('create_course_task_with_initial_proposal', {
          course_task_id: TASK_ID,
          class_section_id: SECTION_ID,
          proposal_id: PROPOSAL_ID,
          proposal: proposal(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'inactive_term' });

    await client.query(
      `update academic_terms set status_override = null where id = $1`,
      [TERM_ID],
    );
    await executor.execute(
      USER_ID,
      operation('create_course_task_with_initial_proposal', {
        course_task_id: TASK_ID,
        class_section_id: SECTION_ID,
        proposal_id: PROPOSAL_ID,
        proposal: proposal(),
      }),
    );
    await client.query(
      `update course_tasks set state = 'hidden' where id = $1`,
      [TASK_ID],
    );
    await expect(
      executor.execute(
        USER_ID,
        operation('create_task_proposal', {
          course_task_id: TASK_ID,
          proposal_id: PROPOSAL_2_ID,
          proposal: proposal('Other'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'content_hidden' });
  });
});
