import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresModerationRepository } from '../src/admin/postgres-moderation-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const ACTOR_ID = '018f0000-0000-7000-8000-000000003401';
const REPORTER_ID = '018f0000-0000-7000-8000-000000003402';
const TERM_ID = '018f0000-0000-7000-8000-000000003403';
const COURSE_ID = '018f0000-0000-7000-8000-000000003404';
const SECTION_ID = '018f0000-0000-7000-8000-000000003405';
const TASK_ID = '018f0000-0000-7000-8000-000000003406';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000003407';
const COMMENT_ID = '018f0000-0000-7000-8000-000000003408';
const REPORT_ID = '018f0000-0000-7000-8000-000000003409';
const REQUEST_ID = '018f0000-0000-7000-8000-000000003410';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function ids(): () => string {
  let value = 3400;
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
       ($1, 'maintainer', 'maintainer', 'Maintainer', 'active', 1),
       ($2, 'reporter', 'reporter', 'Reporter', 'active', 1)`,
    [ACTOR_ID, REPORTER_ID],
  );
  await client.query(
    `insert into academic_terms (id, external_term_code, name)
     values ($1, 'term-moderation', 'Term')`,
    [TERM_ID],
  );
  await client.query(
    `insert into courses (id, term_id, external_course_code, name)
     values ($1, $2, 'course-moderation', 'Course')`,
    [COURSE_ID, TERM_ID],
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number
     ) values ($1, $2, 'section-moderation', '01')`,
    [SECTION_ID, COURSE_ID],
  );
  await client.query(
    `insert into course_tasks (id, class_section_id, created_by)
     values ($1, $2, $3)`,
    [TASK_ID, SECTION_ID, REPORTER_ID],
  );
  await client.query(
    `insert into task_proposals (
       id, task_id, author_id, title, deadline, content_fingerprint
     ) values ($1, $2, $3, 'Task', '2026-07-20T12:00:00Z', $4)`,
    [PROPOSAL_ID, TASK_ID, REPORTER_ID, 'b'.repeat(64)],
  );
  await client.query(
    `insert into task_comments (id, task_id, author_id)
     values ($1, $2, $3)`,
    [COMMENT_ID, TASK_ID, REPORTER_ID],
  );
  await client.query(
    `insert into comment_revisions (comment_id, revision, body, author_id)
     values ($1, 1, 'Comment', $2)`,
    [COMMENT_ID, REPORTER_ID],
  );
  await client.query(
    `insert into content_reports (
       id, reporter_id, target_type, target_id, reason, details
     ) values ($1, $2, 'proposal', $3, 'inaccurate', 'Wrong date')`,
    [REPORT_ID, REPORTER_ID, PROPOSAL_ID],
  );
}

describePostgres('PostgresModerationRepository', () => {
  let client: Client;
  let repository: PostgresModerationRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresModerationRepository(client, {
      createId: ids(),
      now: () => NOW,
    });
  });

  beforeEach(async () => {
    await client.query(`
      truncate table sync_events, audit_log, moderation_actions,
        content_reports, comment_revisions, task_comments, task_proposals,
        course_tasks, class_sections, courses, academic_terms, users
        restart identity cascade
    `);
    await seed(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('hides and restores a proposal with public events and audit', async () => {
    await repository.setContentHidden({
      actorId: ACTOR_ID,
      targetType: 'proposal',
      targetId: PROPOSAL_ID,
      hidden: true,
      reason: 'Confirmed inaccurate.',
      requestId: REQUEST_ID,
    });
    await repository.setContentHidden({
      actorId: ACTOR_ID,
      targetType: 'proposal',
      targetId: PROPOSAL_ID,
      hidden: false,
      reason: 'Corrected disposition.',
      requestId: REQUEST_ID,
    });

    const state = await client.query<{
      state: string;
      revision: number;
      actions: string;
      audits: string;
      events: string;
    }>(
      `select p.state, p.revision,
         (select count(*) from moderation_actions)::text as actions,
         (select count(*) from audit_log)::text as audits,
         (select count(*) from sync_events
          where type in ('task_proposal_hidden', 'task_proposal_restored'))::text as events
       from task_proposals p where p.id = $1`,
      [PROPOSAL_ID],
    );
    expect(state.rows[0]).toEqual({
      state: 'visible',
      revision: 3,
      actions: '2',
      audits: '2',
      events: '2',
    });

    const events = await client.query<{
      type: string;
      payload: Record<string, unknown>;
    }>(
      `select type, payload from sync_events
       where type in ('task_proposal_hidden', 'task_proposal_restored')
       order by sequence`,
    );
    expect(events.rows).toEqual([
      {
        type: 'task_proposal_hidden',
        payload: {
          entity_type: 'task_proposal',
          entity_id: PROPOSAL_ID,
          state: 'hidden',
          revision: 2,
        },
      },
      {
        type: 'task_proposal_restored',
        payload: expect.objectContaining({
          id: PROPOSAL_ID,
          course_task_id: TASK_ID,
          author_id: REPORTER_ID,
          title: 'Task',
          deadline: '2026-07-20T12:00:00.000Z',
          content_fingerprint: 'b'.repeat(64),
          state: 'visible',
          revision: 3,
        }),
      },
    ]);
  });

  it('audits an idempotent moderation request without duplicate events', async () => {
    await repository.setContentHidden({
      actorId: ACTOR_ID,
      targetType: 'proposal',
      targetId: PROPOSAL_ID,
      hidden: true,
      reason: 'Confirmed inaccurate.',
      requestId: REQUEST_ID,
    });
    await expect(
      repository.setContentHidden({
        actorId: ACTOR_ID,
        targetType: 'proposal',
        targetId: PROPOSAL_ID,
        hidden: true,
        reason: 'Confirm hidden disposition.',
        requestId: REQUEST_ID,
      }),
    ).resolves.toMatchObject({ state: 'hidden', revision: 2, changed: false });

    const counts = await client.query<{
      actions: string;
      audits: string;
      events: string;
    }>(
      `select
         (select count(*) from moderation_actions)::text as actions,
         (select count(*) from audit_log)::text as audits,
         (select count(*) from sync_events
          where type = 'task_proposal_hidden')::text as events`,
    );
    expect(counts.rows[0]).toEqual({
      actions: '1',
      audits: '2',
      events: '1',
    });
  });

  it('lists and resolves a report without exposing it publicly', async () => {
    const listed = await repository.listReports({ status: 'open', limit: 20 });
    expect(listed.reports[0]).toMatchObject({
      id: REPORT_ID,
      reporter_id: REPORTER_ID,
      details: 'Wrong date',
    });

    await repository.resolveReport({
      actorId: ACTOR_ID,
      reportId: REPORT_ID,
      status: 'resolved',
      resolution: 'Proposal hidden.',
      requestId: REQUEST_ID,
    });

    const events = await client.query<{
      scope: string;
      type: string;
      payload: Record<string, unknown>;
    }>(
      `select scope, type, payload from sync_events
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
    expect(events.rows[0]?.payload).toEqual({
      report_id: REPORT_ID,
      status: 'resolved',
      resolution: 'Proposal hidden.',
      resolved_at: NOW.toISOString(),
    });
    expect(events.rows[1]?.payload).toMatchObject({
      report_id: REPORT_ID,
      reporter_id: REPORTER_ID,
      target_type: 'proposal',
      target_id: PROPOSAL_ID,
      reason: 'inaccurate',
      details: 'Wrong date',
      status: 'resolved',
      resolution: 'Proposal hidden.',
      resolved_at: NOW.toISOString(),
    });
    expect(events.rows.some(({ scope }) => scope === 'class_section_public')).toBe(
      false,
    );
  });

  it('returns append-only audit pages', async () => {
    await repository.setContentHidden({
      actorId: ACTOR_ID,
      targetType: 'comment',
      targetId: COMMENT_ID,
      hidden: true,
      reason: 'Contains abuse.',
      requestId: REQUEST_ID,
    });
    const page = await repository.listAudit({ limit: 10 });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      actor_id: ACTOR_ID,
      action: 'comment_hidden',
      target_id: COMMENT_ID,
    });
  });
});
