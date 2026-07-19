import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresTaskMergeRepository } from '../src/admin/postgres-task-merge-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const ACTOR_ID = '018f0000-0000-7000-8000-000000003701';
const CONFLICT_USER = '018f0000-0000-7000-8000-000000003702';
const MOVE_USER = '018f0000-0000-7000-8000-000000003703';
const STATE_USER = '018f0000-0000-7000-8000-000000003704';
const TERM_ID = '018f0000-0000-7000-8000-000000003705';
const COURSE_ID = '018f0000-0000-7000-8000-000000003706';
const SECTION_ID = '018f0000-0000-7000-8000-000000003707';
const TARGET_TASK = '018f0000-0000-7000-8000-000000003708';
const SOURCE_TASK = '018f0000-0000-7000-8000-000000003709';
const TARGET_PROPOSAL = '018f0000-0000-7000-8000-000000003710';
const SOURCE_PROPOSAL = '018f0000-0000-7000-8000-000000003711';
const REQUEST_ID = '018f0000-0000-7000-8000-000000003712';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function ids(): () => string {
  let value = 3790;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

async function seed(client: Client): Promise<void> {
  await client.query(
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values
       ($1, 'actor-private', 'actor_private', 'Actor', 'active', 1),
       ($2, 'conflict-user', 'conflict_user', 'Conflict', 'active', 1),
       ($3, 'move-user', 'move_user', 'Move', 'active', 1),
       ($4, 'state-user', 'state_user', 'State', 'active', 1)`,
    [ACTOR_ID, CONFLICT_USER, MOVE_USER, STATE_USER],
  );
  await client.query(
    `insert into academic_terms (id, external_term_code, name)
     values ($1, 'term-merge-private', 'Term')`,
    [TERM_ID],
  );
  await client.query(
    `insert into courses (id, term_id, external_course_code, name)
     values ($1, $2, 'course-merge-private', 'Course')`,
    [COURSE_ID, TERM_ID],
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number
     ) values ($1, $2, 'section-merge-private', '01')`,
    [SECTION_ID, COURSE_ID],
  );
  await client.query(
    `insert into course_tasks (id, class_section_id, created_by) values
       ($1, $3, $4), ($2, $3, $4)`,
    [TARGET_TASK, SOURCE_TASK, SECTION_ID, ACTOR_ID],
  );
  await client.query(
    `insert into task_proposals (
       id, task_id, author_id, title, deadline, content_fingerprint
     ) values
       ($1, $3, $5, 'Target', '2026-07-20T12:00:00Z', $6),
       ($2, $4, $5, 'Source', '2026-07-21T12:00:00Z', $7)`,
    [
      TARGET_PROPOSAL,
      SOURCE_PROPOSAL,
      TARGET_TASK,
      SOURCE_TASK,
      ACTOR_ID,
      'c'.repeat(64),
      'd'.repeat(64),
    ],
  );

  await client.query(
    `insert into personal_task_details (
       user_id, task_id, private_title, private_deadline, private_note,
       revision
     ) values
       ($1, $3, 'Target private', '2026-07-20T10:00:00Z', 'Keep', 2),
       ($1, $4, 'Source private', '2026-07-21T10:00:00Z', 'Recover', 3),
       ($2, $4, 'Move private', null, 'Move note', 4)`,
    [CONFLICT_USER, MOVE_USER, TARGET_TASK, SOURCE_TASK],
  );
  await client.query(
    `insert into personal_task_states (user_id, task_id, state, revision) values
       ($1, $4, 'ignored', 2),
       ($1, $5, 'completed', 3),
       ($2, $4, 'ignored', 2),
       ($2, $5, 'completed', 3),
       ($3, $4, 'ignored', 2),
       ($3, $5, 'pending', 3)`,
    [CONFLICT_USER, MOVE_USER, STATE_USER, TARGET_TASK, SOURCE_TASK],
  );
}

describePostgres('PostgresTaskMergeRepository private overlays', () => {
  let client: Client;
  let repository: PostgresTaskMergeRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresTaskMergeRepository(client, {
      createId: ids(),
      now: () => NOW,
    });
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_events, audit_log, task_merges, proposal_redirects,
        personal_todos, personal_task_details, personal_task_states,
        proposal_vote_totals, accuracy_votes, task_proposals, course_tasks,
        class_sections, courses, academic_terms, users restart identity cascade
    `);
    await seed(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('recovers conflicting source details as a todo with the source state', async () => {
    const result = await repository.merge({
      actorId: ACTOR_ID,
      sourceTaskId: SOURCE_TASK,
      targetTaskId: TARGET_TASK,
      reason: 'Private conflict test.',
      requestId: REQUEST_ID,
    });
    expect(result).toMatchObject({ recovered_personal_todos: 1 });

    const details = await client.query<{
      user_id: string;
      task_id: string;
      private_title: string | null;
    }>(
      `select user_id, task_id, private_title
       from personal_task_details
       order by user_id, task_id`,
    );
    expect(details.rows).toContainEqual({
      user_id: CONFLICT_USER,
      task_id: TARGET_TASK,
      private_title: 'Target private',
    });
    expect(details.rows).not.toContainEqual(
      expect.objectContaining({ user_id: CONFLICT_USER, task_id: SOURCE_TASK }),
    );

    const todo = await client.query<{
      user_id: string;
      title: string;
      note: string | null;
      state: string;
    }>('select user_id, title, note, state from personal_todos');
    expect(todo.rows).toContainEqual({
      user_id: CONFLICT_USER,
      title: 'Source private',
      note: 'Recover',
      state: 'completed',
    });
    const conflictState = await client.query(
      `select 1 from personal_task_states
       where user_id = $1 and task_id = $2`,
      [CONFLICT_USER, SOURCE_TASK],
    );
    expect(conflictState.rowCount).toBe(0);
  });

  it('moves non-conflicting details and merges states by deterministic priority', async () => {
    await repository.merge({
      actorId: ACTOR_ID,
      sourceTaskId: SOURCE_TASK,
      targetTaskId: TARGET_TASK,
      reason: 'Private movement test.',
      requestId: REQUEST_ID,
    });

    const moved = await client.query<{
      task_id: string;
      private_title: string | null;
      revision: number;
    }>(
      `select task_id, private_title, revision
       from personal_task_details where user_id = $1`,
      [MOVE_USER],
    );
    expect(moved.rows[0]).toEqual({
      task_id: TARGET_TASK,
      private_title: 'Move private',
      revision: 5,
    });

    const states = await client.query<{
      user_id: string;
      task_id: string;
      state: string;
    }>(
      `select user_id, task_id, state
       from personal_task_states
       where user_id = any($1::uuid[])
       order by user_id`,
      [[MOVE_USER, STATE_USER]],
    );
    expect(states.rows).toEqual([
      { user_id: MOVE_USER, task_id: TARGET_TASK, state: 'completed' },
      { user_id: STATE_USER, task_id: TARGET_TASK, state: 'pending' },
    ]);

    const privateEvents = await client.query<{ type: string }>(
      `select type from sync_events
       where scope = 'private_user'
       order by sequence`,
    );
    expect(privateEvents.rows.map(({ type }) => type)).toContain(
      'personal_task_details_upserted',
    );
    expect(privateEvents.rows.map(({ type }) => type)).toContain(
      'personal_task_state_upserted',
    );
  });
});
