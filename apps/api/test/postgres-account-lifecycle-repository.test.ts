import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresAccountLifecycleRepository } from '../src/auth/postgres-account-lifecycle-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const NOW = new Date('2026-07-19T12:00:00.000Z');
const USER_ID = '018f0000-0000-7000-8000-000000000201';
const OTHER_USER_ID = '018f0000-0000-7000-8000-000000000202';
const EVENT_ID = '018f0000-0000-7000-8000-000000000203';

async function insertUser(
  client: Client,
  id: string,
  username: string,
): Promise<void> {
  await client.query(
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values ($1, $2, $2, $3, 'active', 1)`,
    [id, username, username],
  );
}

describePostgres('PostgresAccountLifecycleRepository', () => {
  let client: Client;
  let repository: PostgresAccountLifecycleRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresAccountLifecycleRepository(client);
  });

  beforeEach(async () => {
    await client.query(`
      truncate table
        sync_events, operation_receipts, rate_limit_counters, accuracy_votes,
        proposal_vote_totals,
        task_proposals, course_tasks, personal_todos, followed_class_sections,
        sessions, oidc_identities, user_roles, class_sections, courses,
        academic_terms, users
      cascade
    `);
  });

  afterAll(async () => {
    await client.end();
  });

  it('updates a profile at the expected revision and appends a public event', async () => {
    await insertUser(client, USER_ID, 'student');

    await expect(
      repository.updateProfile({
        userId: USER_ID,
        username: 'new_name',
        displayName: 'New Name',
        avatarUrl: 'https://example.com/avatar.png',
        bio: 'Course representative',
        expectedRevision: 1,
        now: NOW,
        eventId: EVENT_ID,
      }),
    ).resolves.toMatchObject({
      kind: 'success',
      user: {
        username: 'new_name',
        avatarUrl: 'https://example.com/avatar.png',
        bio: 'Course representative',
        profileRevision: 2,
      },
    });

    const event = await client.query<{ type: string; payload: unknown }>(
      'select type, payload from sync_events where event_id = $1',
      [EVENT_ID],
    );
    expect(event.rows[0]).toMatchObject({
      type: 'public_user_profile_updated',
      payload: {
        id: USER_ID,
        username: 'new_name',
        display_name: 'New Name',
        avatar_url: 'https://example.com/avatar.png',
        bio: 'Course representative',
        status: 'active',
        revision: 2,
        updated_at: NOW.toISOString(),
      },
    });
  });

  it('returns current state on revision conflict without appending an event', async () => {
    await insertUser(client, USER_ID, 'student');

    await expect(
      repository.updateProfile({
        userId: USER_ID,
        username: 'new_name',
        displayName: 'New Name',
        avatarUrl: null,
        bio: null,
        expectedRevision: 9,
        now: NOW,
        eventId: EVENT_ID,
      }),
    ).resolves.toMatchObject({
      kind: 'revision_conflict',
      current: { profileRevision: 1 },
    });
    const count = await client.query<{ count: string }>(
      'select count(*)::text as count from sync_events',
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('anonymizes public authors, preserves votes, clears private data, and releases username', async () => {
    await insertUser(client, USER_ID, 'student');
    await client.query(
      `insert into oidc_identities (id, user_id, issuer, subject, email)
       values ($1, $2, 'https://issuer.example', 'student', 'student@example.edu')`,
      ['018f0000-0000-7000-8000-000000000204', USER_ID],
    );
    await client.query(
      `insert into sessions (
         id, user_id, token_hash, device_metadata, idle_expires_at, absolute_expires_at
       ) values ($1, $2, 'hash', '{}'::jsonb, $3, $4)`,
      [
        '018f0000-0000-7000-8000-000000000205',
        USER_ID,
        new Date(NOW.getTime() + 60_000),
        new Date(NOW.getTime() + 120_000),
      ],
    );
    await client.query(
      `insert into academic_terms (id, external_term_code, name)
       values ($1, 'term', 'Term')`,
      ['018f0000-0000-7000-8000-000000000206'],
    );
    await client.query(
      `insert into courses (id, term_id, external_course_code, name)
       values ($1, $2, '001', 'Course')`,
      [
        '018f0000-0000-7000-8000-000000000207',
        '018f0000-0000-7000-8000-000000000206',
      ],
    );
    await client.query(
      `insert into class_sections (
         id, course_id, external_section_id, section_number
       ) values ($1, $2, 'section', '01')`,
      [
        '018f0000-0000-7000-8000-000000000208',
        '018f0000-0000-7000-8000-000000000207',
      ],
    );
    await client.query(
      `insert into course_tasks (id, class_section_id, created_by)
       values ($1, $2, $3)`,
      [
        '018f0000-0000-7000-8000-000000000209',
        '018f0000-0000-7000-8000-000000000208',
        USER_ID,
      ],
    );
    await client.query(
      `insert into task_proposals (
         id, task_id, author_id, title, deadline, content_fingerprint
       ) values ($1, $2, $3, 'Task', $4, 'fingerprint')`,
      [
        '018f0000-0000-7000-8000-000000000210',
        '018f0000-0000-7000-8000-000000000209',
        USER_ID,
        new Date(NOW.getTime() + 86_400_000),
      ],
    );
    await client.query(
      `insert into accuracy_votes (user_id, proposal_id, direction)
       values ($1, $2, 'up')`,
      [USER_ID, '018f0000-0000-7000-8000-000000000210'],
    );
    await client.query(
      `insert into personal_todos (id, user_id, title)
       values ($1, $2, 'Private')`,
      ['018f0000-0000-7000-8000-000000000211', USER_ID],
    );
    await client.query(
      `insert into operation_receipts (
         user_id, operation_id, request_digest, status, stable_result, expires_at
       ) values ($1, $2, 'digest', 'applied', '{}'::jsonb, $3)`,
      [
        USER_ID,
        '018f0000-0000-7000-8000-000000000212',
        new Date(NOW.getTime() + 60_000),
      ],
    );
    await client.query(
      `insert into rate_limit_counters (
         scope, subject_key, window_start, count, expires_at
       ) values ('sync_user_minute', $1, $2, 1, $3)`,
      [USER_ID, NOW, new Date(NOW.getTime() + 60_000)],
    );
    await client.query(
      `insert into sync_events (
         event_id, scope, scope_user_id, type, schema_version, payload
       ) values ($1, 'private_user', $2, 'personal_todo_upserted', 1, '{}'::jsonb)`,
      ['018f0000-0000-7000-8000-000000000213', USER_ID],
    );

    await expect(repository.deleteAccount(USER_ID, NOW, EVENT_ID)).resolves.toBe(
      'deleted',
    );

    const state = await client.query<{
      status: string;
      display_name: string;
      username: string;
    }>('select status, display_name, username from users where id = $1', [USER_ID]);
    expect(state.rows[0]).toMatchObject({
      status: 'deleted',
      display_name: '已注销用户',
    });
    expect(state.rows[0]?.username).not.toBe('student');

    const privateCounts = await client.query<{
      identities: string;
      sessions: string;
      todos: string;
      receipts: string;
      private_events: string;
      rate_limits: string;
    }>(
      `select
         (select count(*) from oidc_identities where user_id = $1)::text as identities,
         (select count(*) from sessions where user_id = $1)::text as sessions,
         (select count(*) from personal_todos where user_id = $1)::text as todos,
         (select count(*) from operation_receipts where user_id = $1)::text as receipts,
         (select count(*) from sync_events where scope_user_id = $1)::text as private_events,
         (select count(*) from rate_limit_counters where subject_key = $1::text)::text as rate_limits`,
      [USER_ID],
    );
    expect(privateCounts.rows[0]).toEqual({
      identities: '0',
      sessions: '0',
      todos: '0',
      receipts: '0',
      private_events: '0',
      rate_limits: '0',
    });

    const deletionEvent = await client.query<{
      type: string;
      payload: Record<string, unknown>;
    }>('select type, payload from sync_events where event_id = $1', [EVENT_ID]);
    expect(deletionEvent.rows[0]).toMatchObject({
      type: 'public_user_deleted',
      payload: {
        id: USER_ID,
        display_name: '已注销用户',
        status: 'deleted',
        revision: 2,
        deleted_at: NOW.toISOString(),
      },
    });

    const proposal = await client.query<{ author_id: string | null }>(
      'select author_id from task_proposals where id = $1',
      ['018f0000-0000-7000-8000-000000000210'],
    );
    expect(proposal.rows[0]?.author_id).toBeNull();
    const votes = await client.query<{ count: string }>(
      'select count(*)::text as count from accuracy_votes where user_id = $1',
      [USER_ID],
    );
    expect(votes.rows[0]?.count).toBe('1');

    await expect(insertUser(client, OTHER_USER_ID, 'student')).resolves.toBeUndefined();
  });

  it('protects the final active maintainer', async () => {
    await insertUser(client, USER_ID, 'maintainer');
    await client.query(
      `insert into user_roles (user_id, role) values ($1, 'maintainer')`,
      [USER_ID],
    );

    await expect(repository.deleteAccount(USER_ID, NOW, EVENT_ID)).resolves.toBe(
      'last_maintainer',
    );
    const user = await client.query<{ status: string }>(
      'select status from users where id = $1',
      [USER_ID],
    );
    expect(user.rows[0]?.status).toBe('active');
  });
});
