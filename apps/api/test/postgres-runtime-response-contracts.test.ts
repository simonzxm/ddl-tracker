import {
  adminAuditPageSchema,
  adminBootstrapResponseSchema,
  adminContentActionResponseSchema,
  adminReportPageSchema,
  adminReportResolutionResponseSchema,
  adminRoleResponseSchema,
  adminUserActionResponseSchema,
  classSectionsResponseSchema,
  commentRevisionPageSchema,
  coursesResponseSchema,
  currentUserSchema,
  oidcAuthorizationResponseSchema,
  sessionListResponseSchema,
  sessionVerificationResponseSchema,
  syncResponseSchema,
  termsResponseSchema,
} from '@ddl-tracker/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertDisposableTestDatabaseUrl } from '../../../scripts/test-database-url.mjs';
import type { OidcProvider } from '../src/auth/oidc-provider-client.js';
import { createRuntimeApp } from '../src/runtime-app.js';

const configuredDatabaseUrl = process.env['TEST_DATABASE_URL'];
const databaseUrl =
  configuredDatabaseUrl === undefined
    ? undefined
    : assertDisposableTestDatabaseUrl(configuredDatabaseUrl);
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const NOW = new Date('2026-08-05T07:00:00.000Z');
const TARGET_USER_ID = '018f0000-0000-7000-8000-000000009101';
const TERM_ID = '018f0000-0000-7000-8000-000000009102';
const COURSE_ID = '018f0000-0000-7000-8000-000000009103';
const SECTION_ID = '018f0000-0000-7000-8000-000000009104';
const TASK_ID = '018f0000-0000-7000-8000-000000009105';
const COMMENT_ID = '018f0000-0000-7000-8000-000000009106';
const REPORT_ID = '018f0000-0000-7000-8000-000000009107';
const HISTORICAL_REPORT_ID = '018f0000-0000-7000-8000-000000009108';
const EMPTY_RESOLUTION_REPORT_ID = '018f0000-0000-7000-8000-000000009109';
const AUDIT_ID = '018f0000-0000-7000-8000-000000009110';
const LONG_RESOLUTION_EVENT_ID = '018f0000-0000-7000-8000-000000009111';
const EMPTY_RESOLUTION_EVENT_ID = '018f0000-0000-7000-8000-000000009112';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000009113';
const MERGED_TASK_ID = '018f0000-0000-7000-8000-000000009114';
const PERSONAL_TODO_ID = '018f0000-0000-7000-8000-000000009115';
const REPLAY_OPERATION_ID = '018f0000-0000-7000-8000-000000009116';
const REPLAY_COMMENT_ID = '018f0000-0000-7000-8000-000000009117';
const MISSING_TASK_ID = '018f0000-0000-7000-8000-000000009118';
const LEGACY_REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const LEGACY_TARGET_ID = '550e8400-e29b-41d4-a716-446655440001';
const HASH = 'a'.repeat(64);
const LONG_TEXT = 'X'.repeat(10_001);
function environment(): Env {
  return {
    HYPERDRIVE: {
      connectionString: databaseUrl ?? 'postgresql://invalid',
    } as Hyperdrive,
    AUTH_SERVER: {
      fetch: vi.fn(async () => new Response(null, { status: 404 })),
    } as unknown as Fetcher,
    APP_ENVIRONMENT: 'development',
    OIDC_ISSUER: 'https://issuer.example',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_REDIRECT_URI: 'https://api.example/api/v1/auth/oidc/callback',
    OIDC_POST_LOGIN_REDIRECT_URIS: 'ddltracker.mac://auth/callback',
    OIDC_TRANSACTION_SECRET: 'o'.repeat(64),
    TOKEN_PEPPER: 'p'.repeat(64),
    SYNC_TOKEN_SECRET: 's'.repeat(64),
    MAINTAINER_BOOTSTRAP_TOKEN: 'b'.repeat(64),
  };
}

function ids(): () => string {
  let value = 9_200;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

const oidcProvider: OidcProvider = {
  createAuthorizationUrl: vi.fn(async ({ state }) => {
    const url = new URL('https://issuer.example/authorize');
    url.searchParams.set('state', state);
    return url.toString();
  }),
  exchangeAuthorizationCode: vi.fn(async () => ({
    issuer: 'https://issuer.example',
    subject: 'student-runtime-contract',
    email: 'student@example.edu',
    displayName: 'Runtime Student',
    avatarUrl: null,
  })),
};

async function signIn(app: ReturnType<typeof createRuntimeApp>): Promise<{
  accessToken: string;
  userId: string;
}> {
  const start = await app.request('/api/v1/auth/oidc/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uri: 'ddltracker.mac://auth/callback',
    }),
  });
  expect(start.status).toBe(200);
  const authorization = oidcAuthorizationResponseSchema.parse(await start.json());
  const state = new URL(authorization.authorization_url).searchParams.get('state');
  expect(state).not.toBeNull();

  const callback = await app.request(
    `/api/v1/auth/oidc/callback?state=${encodeURIComponent(state ?? '')}&code=provider-code`,
    { redirect: 'manual' },
  );
  expect(callback.status).toBe(302);
  const location = callback.headers.get('location');
  expect(location).not.toBeNull();
  const exchangeCode = new URL(location ?? '').searchParams.get('code');
  expect(exchangeCode).not.toBeNull();

  const exchange = await app.request('/api/v1/auth/oidc/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: exchangeCode,
      device_name: 'Integration Mac',
      device_metadata: { platform: 'macos' },
    }),
  });
  expect(exchange.status).toBe(200);
  const rawSession: unknown = await exchange.json();
  expect(rawSession).toEqual(
    expect.objectContaining({
      kind: 'session',
      access_token: expect.any(String),
      token_type: 'Bearer',
      expires_at: expect.any(String),
      user: expect.any(Object),
    }),
  );
  expect(Object.keys(rawSession as Record<string, unknown>).sort()).toEqual([
    'access_token',
    'expires_at',
    'kind',
    'token_type',
    'user',
  ]);
  const session = sessionVerificationResponseSchema.parse(rawSession);
  return { accessToken: session.access_token, userId: session.user.id };
}

async function seedVisibleContent(
  client: Client,
  userId: string,
): Promise<void> {
  await client.query(
    `update users
     set username = '', display_name = $1, avatar_url = $2, bio = $1
     where id = $3`,
    [LONG_TEXT, 'historical-not-a-url', userId],
  );
  await client.query(
    `update sessions set device_name = $1 where user_id = $2`,
    [LONG_TEXT, userId],
  );
  await client.query(
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values ($1, 'target_user', 'target_user', 'Target User', 'active', 1)`,
    [TARGET_USER_ID],
  );
  await client.query(
    `insert into academic_terms (
       id, external_term_code, name, starts_on, ends_on
     ) values ($1, '2026-2027-1', $2, '2026-08-01', '2027-01-31')`,
    [TERM_ID, LONG_TEXT],
  );
  await client.query(
    `insert into courses (id, term_id, external_course_code, name, credits)
     values ($1, $2, 'COURSE-1', $3, 3.00)`,
    [COURSE_ID, TERM_ID, LONG_TEXT],
  );
  const instructors = Array.from({ length: 101 }, (_, index) =>
    index === 0 ? LONG_TEXT : `Teacher ${String(index)}`,
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number, department_code,
       department_name, instructors, campus, capacity, schedule_text,
       active, revision
     ) values ($1, $2, 'SECTION-1', $3, $4, '', $5::jsonb, $6, 100, $7,
       true, 1)`,
    [
      SECTION_ID,
      COURSE_ID,
      LONG_TEXT,
      LONG_TEXT,
      JSON.stringify(instructors),
      LONG_TEXT,
      LONG_TEXT,
    ],
  );
  await client.query(
    `insert into course_tasks (id, class_section_id, created_by)
     values ($1, $2, $3)`,
    [TASK_ID, SECTION_ID, userId],
  );
  await client.query(
    `insert into course_tasks (
       id, class_section_id, created_by, state, revision
     ) values ($1, $2, $3, 'merged', 2)`,
    [MERGED_TASK_ID, SECTION_ID, userId],
  );
  await client.query(
    `insert into task_merges (
       source_task_id, target_task_id, maintainer_id, reason, created_at
     ) values ($1, $2, $3, $4, $5)`,
    [MERGED_TASK_ID, TASK_ID, userId, LONG_TEXT, NOW],
  );
  await client.query(
    `insert into task_proposals (
       id, task_id, author_id, title, deadline, description, evidence_note,
       evidence_url, content_fingerprint, state, revision, created_at
     ) values ($1, $2, $3, '', $4, $5, $5, $6, $7, 'visible', 1, $4)`,
    [
      PROPOSAL_ID,
      TASK_ID,
      userId,
      NOW,
      LONG_TEXT,
      'historical-not-a-url',
      HASH,
    ],
  );
  await client.query(
    `insert into proposal_vote_totals (
       proposal_id, up, down, revision, updated_at
     ) values ($1, 1, 0, 1, $2)`,
    [PROPOSAL_ID, NOW],
  );
  await client.query(
    `insert into task_comments (id, task_id, author_id, current_revision)
     values ($1, $2, $3, 1)`,
    [COMMENT_ID, TASK_ID, userId],
  );
  await client.query(
    `insert into comment_revisions (
       comment_id, revision, body, author_id, created_at
     ) values ($1, 1, $2, $3, $4)`,
    [COMMENT_ID, 'C'.repeat(4_001), userId, NOW],
  );
  await client.query(
    `insert into followed_class_sections (user_id, class_section_id, created_at)
     values ($1, $2, $3)`,
    [userId, SECTION_ID, NOW],
  );
  await client.query(
    `insert into personal_todos (
       id, user_id, class_section_id, title, note, state, revision,
       created_at, updated_at
     ) values ($1, $2, $3, '', $4, 'pending', 1, $5, $5)`,
    [PERSONAL_TODO_ID, userId, SECTION_ID, LONG_TEXT, NOW],
  );
  await client.query(
    `insert into personal_task_details (
       user_id, task_id, private_title, private_note, revision,
       created_at, updated_at
     ) values ($1, $2, $3, '', 1, $4, $4)`,
    [userId, TASK_ID, LONG_TEXT, NOW],
  );
  await client.query(
    `insert into content_reports (
       id, reporter_id, target_type, target_id, reason, details
     ) values ($1, $2, 'comment', $3, 'other', $4)`,
    [REPORT_ID, userId, COMMENT_ID, 'D'.repeat(1_001)],
  );
  await client.query(
    `insert into content_reports (
       id, reporter_id, target_type, target_id, reason, details, status,
       resolution, resolved_by, resolved_at
     ) values ($1, $2, 'comment', $3, 'privacy', $4, 'resolved', $5, $2, $6)`,
    [
      HISTORICAL_REPORT_ID,
      userId,
      COMMENT_ID,
      'D'.repeat(1_001),
      'R'.repeat(1_001),
      NOW,
    ],
  );
  await client.query(
    `insert into content_reports (
       id, reporter_id, target_type, target_id, reason, details, status,
       resolution, resolved_by, resolved_at
     ) values ($1, $2, 'comment', $3, 'other', null, 'dismissed', '', $2, $4)`,
    [EMPTY_RESOLUTION_REPORT_ID, userId, COMMENT_ID, NOW],
  );
  await client.query(
    `insert into audit_log (
       id, actor_id, action, target_type, target_id, reason, result,
       request_id, created_at
     ) values ($1, $2, 'Legacy action v1', 'Imported object', $3, $4,
       '{"state":"visible"}'::jsonb, $5, $6)`,
    [
      AUDIT_ID,
      userId,
      LEGACY_TARGET_ID,
      'R'.repeat(1_001),
      LEGACY_REQUEST_ID,
      NOW,
    ],
  );
}

async function seedHistoricalMaintainerEvents(
  client: Client,
  userId: string,
): Promise<void> {
  const events = [
    {
      eventId: LONG_RESOLUTION_EVENT_ID,
      reportId: HISTORICAL_REPORT_ID,
      status: 'resolved',
      resolution: 'R'.repeat(1_001),
    },
    {
      eventId: EMPTY_RESOLUTION_EVENT_ID,
      reportId: EMPTY_RESOLUTION_REPORT_ID,
      status: 'dismissed',
      resolution: '',
    },
  ] as const;

  for (const event of events) {
    await client.query(
      `insert into sync_events (
         event_id, scope, type, schema_version, payload, occurred_at
       ) values ($1, 'maintainer_private',
         'maintainer_content_report_updated', 2, $2::jsonb, $3)`,
      [
        event.eventId,
        JSON.stringify({
          report_id: event.reportId,
          reporter_id: userId,
          target_type: 'comment',
          target_id: COMMENT_ID,
          reason: 'other',
          details:
            event.eventId === LONG_RESOLUTION_EVENT_ID
              ? 'D'.repeat(1_001)
              : null,
          status: event.status,
          resolution: event.resolution,
          created_at: NOW.toISOString(),
          resolved_at: NOW.toISOString(),
        }),
        NOW,
      ],
    );
  }
}

describePostgres('runtime HTTP response contracts with PostgreSQL', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query(`
      truncate table
        rate_limit_counters,
        oidc_login_transactions,
        sync_events,
        sync_event_retention,
        operation_receipts,
        audit_log,
        moderation_actions,
        content_reports,
        accuracy_votes,
        proposal_vote_totals,
        proposal_redirects,
        task_proposals,
        task_merges,
        comment_revisions,
        task_comments,
        personal_task_states,
        personal_task_details,
        personal_todos,
        followed_class_sections,
        course_tasks,
        class_sections,
        courses,
        academic_terms,
        sessions,
        oidc_identities,
        user_roles,
        users
      restart identity cascade
    `);
    await client.query(
      `update catalog_revision
       set revision = 1, updated_at = $1
       where singleton_id = 1`,
      [NOW],
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it('keeps real OIDC, account, catalog, comments, sync and admin outputs inside their public schemas', async () => {
    const app = createRuntimeApp(client, environment(), {
      createId: ids(),
      now: () => NOW,
      nowMilliseconds: () => NOW.getTime(),
      oidcProvider,
    });
    const signedIn = await signIn(app);
    await seedVisibleContent(client, signedIn.userId);
    const authorization = { authorization: `Bearer ${signedIn.accessToken}` };

    const me = await app.request('/api/v1/me', { headers: authorization });
    expect(me.status).toBe(200);
    const meBody = currentUserSchema.parse(await me.json());
    expect(meBody).toMatchObject({
      username: '',
      display_name: LONG_TEXT,
      avatar_url: 'historical-not-a-url',
      bio: LONG_TEXT,
      roles: [],
    });

    const sessions = await app.request('/api/v1/sessions', {
      headers: authorization,
    });
    expect(sessions.status).toBe(200);
    const sessionsBody = sessionListResponseSchema.parse(await sessions.json());
    expect(sessionsBody.sessions).toHaveLength(1);
    expect(sessionsBody.sessions[0]?.device_name).toBe(LONG_TEXT);

    const terms = await app.request('/api/v1/terms', { headers: authorization });
    expect(terms.status).toBe(200);
    const termsBody = termsResponseSchema.parse(await terms.json());
    expect(termsBody.terms).toHaveLength(1);
    expect(termsBody.terms[0]?.name).toBe(LONG_TEXT);

    const courses = await app.request(`/api/v1/terms/${TERM_ID}/courses`, {
      headers: authorization,
    });
    expect(courses.status).toBe(200);
    const coursesBody = coursesResponseSchema.parse(await courses.json());
    expect(coursesBody.courses).toHaveLength(1);
    expect(coursesBody.courses[0]?.name).toBe(LONG_TEXT);

    const sections = await app.request(
      `/api/v1/courses/${COURSE_ID}/class-sections`,
      { headers: authorization },
    );
    expect(sections.status).toBe(200);
    const sectionsBody = classSectionsResponseSchema.parse(await sections.json());
    expect(sectionsBody.class_sections).toHaveLength(1);
    expect(sectionsBody.class_sections[0]).toMatchObject({
      section_number: LONG_TEXT,
      department_code: LONG_TEXT,
      department_name: '',
      campus: LONG_TEXT,
      schedule_text: LONG_TEXT,
    });
    expect(sectionsBody.class_sections[0]?.instructors).toHaveLength(101);

    const history = await app.request(
      `/api/v1/comments/${COMMENT_ID}/revisions`,
      { headers: authorization },
    );
    expect(history.status).toBe(200);
    const historyBody = commentRevisionPageSchema.parse(await history.json());
    expect(historyBody.revisions).toHaveLength(1);
    expect(historyBody.revisions[0]?.body).toHaveLength(4_001);

    const snapshot = await app.request('/api/v1/sync', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'account_snapshot',
        snapshot_token: null,
        page_token: null,
        snapshot_limit: 100,
        operations: [],
      }),
    });
    expect(snapshot.status).toBe(200);
    const snapshotBody = syncResponseSchema.parse(await snapshot.json());
    expect(snapshotBody.mode).toBe('account_snapshot');
    if (snapshotBody.mode !== 'account_snapshot') {
      throw new Error('Expected an account snapshot response.');
    }
    expect(snapshotBody.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record_type: 'public_user_profile',
          payload: expect.objectContaining({
            id: signedIn.userId,
            username: '',
            display_name: LONG_TEXT,
            avatar_url: 'historical-not-a-url',
            bio: LONG_TEXT,
          }),
        }),
        expect.objectContaining({
          record_type: 'class_section',
          payload: expect.objectContaining({
            id: SECTION_ID,
            section_number: LONG_TEXT,
            schedule_text: LONG_TEXT,
          }),
        }),
        expect.objectContaining({
          record_type: 'personal_todo',
          payload: expect.objectContaining({
            id: PERSONAL_TODO_ID,
            title: '',
            note: LONG_TEXT,
          }),
        }),
        expect.objectContaining({
          record_type: 'personal_task_details',
          payload: expect.objectContaining({
            course_task_id: TASK_ID,
            private_title: LONG_TEXT,
            private_note: '',
          }),
        }),
        expect.objectContaining({
          record_type: 'task_proposal',
          payload: expect.objectContaining({
            id: PROPOSAL_ID,
            title: '',
            description: LONG_TEXT,
            evidence_note: LONG_TEXT,
            evidence_url: 'historical-not-a-url',
          }),
        }),
        expect.objectContaining({
          record_type: 'task_comment',
          payload: expect.objectContaining({
            id: COMMENT_ID,
            body: 'C'.repeat(4_001),
          }),
        }),
        expect.objectContaining({
          record_type: 'task_merge',
          payload: expect.objectContaining({
            source_task_id: MERGED_TASK_ID,
            reason: LONG_TEXT,
          }),
        }),
      ]),
    );
    const historicalReport = snapshotBody.records.find(
      (record) =>
        record.record_type === 'reporter_content_report' &&
        record.payload.report_id === HISTORICAL_REPORT_ID,
    );
    expect(historicalReport).toEqual(
      expect.objectContaining({
        record_type: 'reporter_content_report',
        payload: expect.objectContaining({
          details: 'D'.repeat(1_001),
          resolution: 'R'.repeat(1_001),
          status: 'resolved',
        }),
      }),
    );
    const emptyResolutionReport = snapshotBody.records.find(
      (record) =>
        record.record_type === 'reporter_content_report' &&
        record.payload.report_id === EMPTY_RESOLUTION_REPORT_ID,
    );
    expect(emptyResolutionReport).toEqual(
      expect.objectContaining({
        record_type: 'reporter_content_report',
        payload: expect.objectContaining({
          resolution: '',
          status: 'dismissed',
        }),
      }),
    );

    const sectionSnapshot = await app.request('/api/v1/sync', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'class_section_snapshot',
        cursor: snapshotBody.next_cursor,
        class_section_id: SECTION_ID,
        snapshot_token: null,
        page_token: null,
        snapshot_limit: 100,
        operations: [],
      }),
    });
    expect(sectionSnapshot.status).toBe(200);
    const sectionSnapshotBody = syncResponseSchema.parse(
      await sectionSnapshot.json(),
    );
    if (sectionSnapshotBody.mode !== 'class_section_snapshot') {
      throw new Error('Expected a class section snapshot response.');
    }
    expect(sectionSnapshotBody.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record_type: 'class_section',
          payload: expect.objectContaining({
            id: SECTION_ID,
            instructors: expect.arrayContaining([LONG_TEXT]),
            schedule_text: LONG_TEXT,
          }),
        }),
        expect.objectContaining({
          record_type: 'task_proposal',
          payload: expect.objectContaining({
            id: PROPOSAL_ID,
            title: '',
            description: LONG_TEXT,
            evidence_url: 'historical-not-a-url',
          }),
        }),
        expect.objectContaining({
          record_type: 'task_comment',
          payload: expect.objectContaining({
            id: COMMENT_ID,
            body: 'C'.repeat(4_001),
          }),
        }),
        expect.objectContaining({
          record_type: 'personal_task_details',
          payload: expect.objectContaining({
            private_title: LONG_TEXT,
            private_note: '',
          }),
        }),
      ]),
    );
    if (sectionSnapshotBody.resume_cursor === null) {
      throw new Error('Expected a completed class section snapshot.');
    }

    const rejectedOperation = {
      operation_id: REPLAY_OPERATION_ID,
      schema_version: 1,
      depends_on: [],
      type: 'create_task_comment',
      payload: {
        comment_id: REPLAY_COMMENT_ID,
        course_task_id: MISSING_TASK_ID,
        body: 'Current valid comment',
      },
    } as const;
    const rejectedSync = await app.request('/api/v1/sync', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'incremental',
        cursor: sectionSnapshotBody.resume_cursor,
        event_limit: 100,
        operations: [rejectedOperation],
      }),
    });
    expect(rejectedSync.status).toBe(200);
    const rejectedSyncBody = syncResponseSchema.parse(await rejectedSync.json());
    if (rejectedSyncBody.mode !== 'incremental') {
      throw new Error('Expected an incremental sync response.');
    }
    expect(rejectedSyncBody.operation_results[0]).toMatchObject({
      operation_id: REPLAY_OPERATION_ID,
      status: 'rejected',
      error: { code: 'not_found' },
    });

    const updatedReceipt = await client.query(
      `update operation_receipts
       set stable_result = jsonb_set(
         stable_result,
         '{error,message}',
         to_jsonb($3::text),
         false
       )
       where user_id = $1 and operation_id = $2`,
      [signedIn.userId, REPLAY_OPERATION_ID, LONG_TEXT],
    );
    expect(updatedReceipt.rowCount).toBe(1);

    const replayedSync = await app.request('/api/v1/sync', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'incremental',
        cursor: rejectedSyncBody.next_cursor,
        event_limit: 100,
        operations: [rejectedOperation],
      }),
    });
    expect(replayedSync.status).toBe(200);
    const replayedSyncBody = syncResponseSchema.parse(await replayedSync.json());
    if (replayedSyncBody.mode !== 'incremental') {
      throw new Error('Expected an incremental sync response.');
    }
    expect(replayedSyncBody.operation_results[0]).toMatchObject({
      operation_id: REPLAY_OPERATION_ID,
      status: 'rejected',
      error: { code: 'not_found', message: LONG_TEXT },
    });
    const syncCursor = replayedSyncBody.next_cursor;

    const bootstrap = await app.request('/api/v1/admin/bootstrap', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ bootstrap_token: 'b'.repeat(64) }),
    });
    expect(bootstrap.status).toBe(200);
    expect(
      adminBootstrapResponseSchema.parse(await bootstrap.json()).maintainer,
    ).toBe(true);

    const elevated = await app.request('/api/v1/me', { headers: authorization });
    expect(elevated.status).toBe(200);
    expect(currentUserSchema.parse(await elevated.json()).roles).toEqual([
      'maintainer',
    ]);

    await seedHistoricalMaintainerEvents(client, signedIn.userId);
    const incremental = await app.request('/api/v1/sync', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'incremental',
        cursor: syncCursor,
        event_limit: 100,
        operations: [],
      }),
    });
    expect(incremental.status).toBe(200);
    const incrementalBody = syncResponseSchema.parse(await incremental.json());
    if (incrementalBody.mode !== 'incremental') {
      throw new Error('Expected an incremental sync response.');
    }
    expect(incrementalBody.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_id: LONG_RESOLUTION_EVENT_ID,
          type: 'maintainer_content_report_updated',
          payload: expect.objectContaining({
            details: 'D'.repeat(1_001),
            resolution: 'R'.repeat(1_001),
            status: 'resolved',
          }),
        }),
        expect.objectContaining({
          event_id: EMPTY_RESOLUTION_EVENT_ID,
          type: 'maintainer_content_report_updated',
          payload: expect.objectContaining({
            resolution: '',
            status: 'dismissed',
          }),
        }),
      ]),
    );

    const reports = await app.request('/api/v1/admin/reports', {
      headers: authorization,
    });
    expect(reports.status).toBe(200);
    const reportPage = adminReportPageSchema.parse(await reports.json());
    expect(reportPage.reports[0]?.details).toHaveLength(1_001);

    const audit = await app.request('/api/v1/admin/audit', {
      headers: authorization,
    });
    expect(audit.status).toBe(200);
    const auditPage = adminAuditPageSchema.parse(await audit.json());
    expect(auditPage.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'Legacy action v1',
          target_id: LEGACY_TARGET_ID,
          request_id: LEGACY_REQUEST_ID,
        }),
      ]),
    );

    const hidden = await app.request(
      `/api/v1/admin/content/${COMMENT_ID}/hide`,
      {
        method: 'POST',
        headers: { ...authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          target_type: 'comment',
          reason: 'Reviewed.',
        }),
      },
    );
    expect(hidden.status).toBe(200);
    expect(adminContentActionResponseSchema.parse(await hidden.json()).state).toBe(
      'hidden',
    );

    const resolved = await app.request(
      `/api/v1/admin/reports/${REPORT_ID}/resolve`,
      {
        method: 'POST',
        headers: { ...authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', resolution: 'Handled.' }),
      },
    );
    expect(resolved.status).toBe(200);
    expect(
      adminReportResolutionResponseSchema.parse(await resolved.json()).status,
    ).toBe('resolved');

    const role = await app.request(
      `/api/v1/admin/users/${TARGET_USER_ID}/roles`,
      {
        method: 'POST',
        headers: { ...authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ maintainer: true, reason: 'Rotation.' }),
      },
    );
    expect(role.status).toBe(200);
    expect(adminRoleResponseSchema.parse(await role.json()).maintainer).toBe(true);

    const suspended = await app.request(
      `/api/v1/admin/users/${TARGET_USER_ID}/suspend`,
      {
        method: 'POST',
        headers: { ...authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Reviewed.' }),
      },
    );
    expect(suspended.status).toBe(200);
    expect(
      adminUserActionResponseSchema.parse(await suspended.json()).status,
    ).toBe('suspended');
  });
});
