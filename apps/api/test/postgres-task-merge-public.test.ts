import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresTaskMergeRepository } from '../src/admin/postgres-task-merge-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const ACTOR_ID = '018f0000-0000-7000-8000-000000003601';
const U1 = '018f0000-0000-7000-8000-000000003602';
const U2 = '018f0000-0000-7000-8000-000000003603';
const U3 = '018f0000-0000-7000-8000-000000003604';
const TERM_ID = '018f0000-0000-7000-8000-000000003605';
const COURSE_ID = '018f0000-0000-7000-8000-000000003606';
const SECTION_ID = '018f0000-0000-7000-8000-000000003607';
const OTHER_SECTION_ID = '018f0000-0000-7000-8000-000000003608';
const TARGET_TASK = '018f0000-0000-7000-8000-000000003609';
const SOURCE_TASK = '018f0000-0000-7000-8000-000000003610';
const OTHER_TASK = '018f0000-0000-7000-8000-000000003611';
const TARGET_PROPOSAL = '018f0000-0000-7000-8000-000000003612';
const DUPLICATE_PROPOSAL = '018f0000-0000-7000-8000-000000003613';
const DISTINCT_PROPOSAL = '018f0000-0000-7000-8000-000000003614';
const COMMENT_ID = '018f0000-0000-7000-8000-000000003615';
const REQUEST_ID = '018f0000-0000-7000-8000-000000003616';
const NOW = new Date('2026-07-19T12:00:00.000Z');
const SAME = 'a'.repeat(64);
const DISTINCT = 'b'.repeat(64);

function ids(): () => string {
  let value = 3600;
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
       ($1, 'actor', 'actor', 'Actor', 'active', 1),
       ($2, 'u1', 'u1', 'U1', 'active', 1),
       ($3, 'u2', 'u2', 'U2', 'active', 1),
       ($4, 'u3', 'u3', 'U3', 'active', 1)`,
    [ACTOR_ID, U1, U2, U3],
  );
  await client.query(
    `insert into academic_terms (id, external_term_code, name)
     values ($1, 'term-merge-public', 'Term')`,
    [TERM_ID],
  );
  await client.query(
    `insert into courses (id, term_id, external_course_code, name)
     values ($1, $2, 'course-merge-public', 'Course')`,
    [COURSE_ID, TERM_ID],
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number
     ) values
       ($1, $3, 'section-merge-public-a', '01'),
       ($2, $3, 'section-merge-public-b', '02')`,
    [SECTION_ID, OTHER_SECTION_ID, COURSE_ID],
  );
  await client.query(
    `insert into course_tasks (id, class_section_id, created_by, created_at)
     values
       ($1, $4, $5, '2026-07-18T10:00:00Z'),
       ($2, $4, $5, '2026-07-18T11:00:00Z'),
       ($3, $6, $5, '2026-07-18T12:00:00Z')`,
    [TARGET_TASK, SOURCE_TASK, OTHER_TASK, SECTION_ID, ACTOR_ID, OTHER_SECTION_ID],
  );
  await client.query(
    `insert into task_proposals (
       id, task_id, author_id, title, deadline, content_fingerprint, created_at
     ) values
       ($1, $4, $7, 'Same', '2026-07-20T12:00:00Z', $5,
        '2026-07-18T10:00:00Z'),
       ($2, $6, $7, 'Same', '2026-07-20T12:00:00Z', $5,
        '2026-07-18T11:00:00Z'),
       ($3, $6, $7, 'Distinct', '2026-07-21T12:00:00Z', $8,
        '2026-07-18T12:00:00Z')`,
    [
      TARGET_PROPOSAL,
      DUPLICATE_PROPOSAL,
      DISTINCT_PROPOSAL,
      TARGET_TASK,
      SAME,
      SOURCE_TASK,
      ACTOR_ID,
      DISTINCT,
    ],
  );
  await client.query(
    `insert into accuracy_votes (user_id, proposal_id, direction) values
       ($1, $4, 'up'), ($1, $5, 'up'),
       ($2, $4, 'up'), ($2, $5, 'down'),
       ($3, $5, 'down')`,
    [U1, U2, U3, TARGET_PROPOSAL, DUPLICATE_PROPOSAL],
  );
  await client.query(
    `insert into proposal_vote_totals (proposal_id, up, down) values
       ($1, 2, 0), ($2, 1, 2), ($3, 0, 0)`,
    [TARGET_PROPOSAL, DUPLICATE_PROPOSAL, DISTINCT_PROPOSAL],
  );
  await client.query(
    `insert into task_comments (id, task_id, author_id)
     values ($1, $2, $3)`,
    [COMMENT_ID, SOURCE_TASK, U1],
  );
  await client.query(
    `insert into comment_revisions (comment_id, revision, body, author_id)
     values ($1, 1, 'Move me', $2)`,
    [COMMENT_ID, U1],
  );
}

describePostgres('PostgresTaskMergeRepository public graph', () => {
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
      truncate table sync_events, audit_log, moderation_actions,
        task_merges, proposal_redirects, comment_revisions, task_comments,
        proposal_vote_totals, accuracy_votes, task_proposals, course_tasks,
        class_sections, courses, academic_terms, users restart identity cascade
    `);
    await seed(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('merges proposals, votes, comments, redirects, events, and audit atomically', async () => {
    await expect(
      repository.merge({
        actorId: ACTOR_ID,
        sourceTaskId: SOURCE_TASK,
        targetTaskId: TARGET_TASK,
        reason: 'Confirmed duplicate.',
        requestId: REQUEST_ID,
      }),
    ).resolves.toMatchObject({
      source_task_id: SOURCE_TASK,
      target_task_id: TARGET_TASK,
      redirected_proposals: 1,
      moved_proposals: 1,
    });

    const tasks = await client.query<{ id: string; state: string }>(
      'select id, state from course_tasks order by id',
    );
    expect(tasks.rows.find(({ id }) => id === SOURCE_TASK)?.state).toBe('merged');

    const proposals = await client.query<{
      id: string;
      task_id: string;
      state: string;
    }>('select id, task_id, state from task_proposals order by id');
    expect(proposals.rows.find(({ id }) => id === DUPLICATE_PROPOSAL)).toMatchObject({
      task_id: SOURCE_TASK,
      state: 'redirected',
    });
    expect(proposals.rows.find(({ id }) => id === DISTINCT_PROPOSAL)).toMatchObject({
      task_id: TARGET_TASK,
      state: 'visible',
    });

    const redirect = await client.query<{
      source_proposal_id: string;
      canonical_proposal_id: string;
    }>('select source_proposal_id, canonical_proposal_id from proposal_redirects');
    expect(redirect.rows).toEqual([
      {
        source_proposal_id: DUPLICATE_PROPOSAL,
        canonical_proposal_id: TARGET_PROPOSAL,
      },
    ]);

    const votes = await client.query<{
      user_id: string;
      proposal_id: string;
      direction: string;
    }>('select user_id, proposal_id, direction from accuracy_votes order by user_id');
    expect(votes.rows).toEqual([
      { user_id: U1, proposal_id: TARGET_PROPOSAL, direction: 'up' },
      { user_id: U2, proposal_id: TARGET_PROPOSAL, direction: 'none' },
      { user_id: U3, proposal_id: TARGET_PROPOSAL, direction: 'down' },
    ]);
    const totals = await client.query<{ up: number; down: number }>(
      'select up, down from proposal_vote_totals where proposal_id = $1',
      [TARGET_PROPOSAL],
    );
    expect(totals.rows[0]).toEqual({ up: 1, down: 1 });

    const comment = await client.query<{ task_id: string }>(
      'select task_id from task_comments where id = $1',
      [COMMENT_ID],
    );
    expect(comment.rows[0]?.task_id).toBe(TARGET_TASK);

    const eventCounts = await client.query<{
      merged: string;
      redirected: string;
      reconsider: string;
      audits: string;
    }>(
      `select
         (select count(*) from sync_events where type = 'course_task_merged')::text as merged,
         (select count(*) from sync_events where type = 'task_proposal_redirected')::text as redirected,
         (select count(*) from sync_events
          where type = 'accuracy_vote_updated' and scope = 'private_user')::text as reconsider,
         (select count(*) from audit_log where action = 'course_task_merged')::text as audits`,
    );
    expect(eventCounts.rows[0]).toEqual({
      merged: '1',
      redirected: '1',
      reconsider: '2',
      audits: '1',
    });
    const reconsider = await client.query<{
      scope_user_id: string;
      payload: {
        proposal_id: string;
        value: string;
        revision: number;
        updated_at: string;
        reason: string;
      };
    }>(
      `select scope_user_id, payload from sync_events
       where type = 'accuracy_vote_updated' and scope = 'private_user'
       order by scope_user_id`,
    );
    expect(reconsider.rows).toEqual([
      {
        scope_user_id: U2,
        payload: {
          proposal_id: TARGET_PROPOSAL,
          value: 'none',
          revision: 2,
          updated_at: NOW.toISOString(),
          reason: 'task_merge_conflict',
        },
      },
      {
        scope_user_id: U3,
        payload: {
          proposal_id: TARGET_PROPOSAL,
          value: 'down',
          revision: 2,
          updated_at: NOW.toISOString(),
          reason: 'task_merge_moved',
        },
      },
    ]);

    const structuralEvents = await client.query<{
      type: string;
      payload: Record<string, unknown>;
    }>(
      `select type, payload from sync_events
       where type in ('task_proposal_redirected', 'course_task_merged')
       order by sequence`,
    );
    expect(structuralEvents.rows).toEqual([
      {
        type: 'task_proposal_redirected',
        payload: {
          source_proposal_id: DUPLICATE_PROPOSAL,
          canonical_proposal_id: TARGET_PROPOSAL,
          revision: 2,
          created_at: NOW.toISOString(),
        },
      },
      {
        type: 'course_task_merged',
        payload: {
          source_task_id: SOURCE_TASK,
          target_task_id: TARGET_TASK,
          reason: 'Confirmed duplicate.',
          revision: 2,
          created_at: NOW.toISOString(),
          redirected_proposals: 1,
          moved_proposals: 1,
          recovered_personal_todos: 0,
        },
      },
    ]);

    const totalsEvent = await client.query<{
      payload: Record<string, unknown>;
    }>(
      `select payload from sync_events
       where type = 'proposal_vote_totals_updated'
         and payload->>'proposal_id' = $1
       order by sequence desc
       limit 1`,
      [TARGET_PROPOSAL],
    );
    expect(totalsEvent.rows[0]?.payload).toMatchObject({
      proposal_id: TARGET_PROPOSAL,
      up: 1,
      down: 1,
      revision: 2,
      updated_at: NOW.toISOString(),
    });
  });

  it('rejects cross-section merges', async () => {
    await expect(
      repository.merge({
        actorId: ACTOR_ID,
        sourceTaskId: SOURCE_TASK,
        targetTaskId: OTHER_TASK,
        reason: 'Wrong section.',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
  });

  it('rejects a merge that would create a redirect cycle', async () => {
    await repository.merge({
      actorId: ACTOR_ID,
      sourceTaskId: SOURCE_TASK,
      targetTaskId: TARGET_TASK,
      reason: 'First merge.',
      requestId: REQUEST_ID,
    });
    await expect(
      repository.merge({
        actorId: ACTOR_ID,
        sourceTaskId: TARGET_TASK,
        targetTaskId: SOURCE_TASK,
        reason: 'Cycle.',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
