import { gzipSync } from 'node:zlib';

import {
  adminAuditPageSchema,
  adminBootstrapResponseSchema,
  adminContentActionResponseSchema,
  adminReportPageSchema,
  adminReportResolutionResponseSchema,
  adminRoleResponseSchema,
  adminUserActionResponseSchema,
  catalogApplyResponseSchema,
  catalogImportStatusSchema,
  catalogPlanBatchResponseSchema,
  catalogUploadResponseSchema,
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
const LEGACY_REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const LEGACY_TARGET_ID = '550e8400-e29b-41d4-a716-446655440001';
const HASH = 'a'.repeat(64);
const CATALOG_HEADERS = [
  'XNXQDM',
  'XNXQDM_DISPLAY',
  'KCH',
  'KCM',
  'XF',
  'PKDWDM',
  'PKDWDM_DISPLAY',
  'JXBID',
  'JXBMC',
  'KXH',
  'SKJS',
  'XXXQDM',
  'XXXQDM_DISPLAY',
  'XKZRS',
  'YPSJDD',
  'SKZC',
  'SKXQ',
  'SKJC',
  'SKJAS',
  'JXLDM',
  'JXLDM_DISPLAY',
];

function catalogManifest() {
  return {
    schema_version: 1,
    source_system: 'runtime-contract-test',
    term: {
      external_code: '2026-2027-1',
      display_name: 'Current term',
      starts_on: '2026-08-01',
      ends_on: '2027-01-31',
      time_zone: 'Asia/Shanghai',
    },
  };
}

function catalogCsv(): string {
  const row = [
    '2026-2027-1',
    'Current term',
    'COURSE-1',
    'Contract Course',
    '3.00',
    'DEPT-1',
    'Department',
    'SECTION-1',
    'Contract section',
    '01',
    'Teacher',
    'CAMPUS-1',
    'Campus',
    '100',
    'Monday 1-2',
    '1-16',
    '1',
    '1-2',
    'Room 101',
    'BUILDING-1',
    'Building',
  ];
  return `${CATALOG_HEADERS.join(',')}\n${row.join(',')}\n`;
}

function catalogPlanBody() {
  return {
    import_id: null,
    filename: 'runtime-plan.csv',
    checksum: HASH,
    header_hash: HASH,
    manifest_hash: HASH,
    environment: 'development',
    manifest: catalogManifest(),
    term: catalogManifest().term,
    row_count: 0,
    batch_index: 0,
    total_batches: 1,
    finalize: true,
    courses: [],
    class_sections: [],
  };
}

function catalogUploadBody(): FormData {
  const form = new FormData();
  form.set(
    'catalog',
    new Blob([gzipSync(catalogCsv())]),
    'runtime-catalog.csv.gz',
  );
  form.set('manifest', JSON.stringify(catalogManifest()));
  return form;
}

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
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values ($1, 'target_user', 'target_user', 'Target User', 'active', 1)`,
    [TARGET_USER_ID],
  );
  await client.query(
    `insert into academic_terms (
       id, external_term_code, name, starts_on, ends_on
     ) values ($1, '2026-2027-1', 'Current term', '2026-08-01', '2027-01-31')`,
    [TERM_ID],
  );
  await client.query(
    `insert into courses (id, term_id, external_course_code, name, credits)
     values ($1, $2, 'COURSE-1', 'Contract Course', 3.00)`,
    [COURSE_ID, TERM_ID],
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number, instructors,
       active, revision
     ) values ($1, $2, 'SECTION-1', '01', '["Teacher"]'::jsonb, true, 1)`,
    [SECTION_ID, COURSE_ID],
  );
  await client.query(
    `insert into course_tasks (id, class_section_id, created_by)
     values ($1, $2, $3)`,
    [TASK_ID, SECTION_ID, userId],
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
        catalog_import_batches,
        catalog_imports,
        sync_events,
        sync_event_retention,
        operation_receipts,
        audit_log,
        moderation_actions,
        content_reports,
        comment_revisions,
        task_comments,
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
    expect(currentUserSchema.parse(await me.json()).roles).toEqual([]);

    const sessions = await app.request('/api/v1/sessions', {
      headers: authorization,
    });
    expect(sessions.status).toBe(200);
    expect(sessionListResponseSchema.parse(await sessions.json()).sessions).toHaveLength(1);

    const terms = await app.request('/api/v1/terms', { headers: authorization });
    expect(terms.status).toBe(200);
    expect(termsResponseSchema.parse(await terms.json()).terms).toHaveLength(1);

    const courses = await app.request(`/api/v1/terms/${TERM_ID}/courses`, {
      headers: authorization,
    });
    expect(courses.status).toBe(200);
    expect(coursesResponseSchema.parse(await courses.json()).courses).toHaveLength(1);

    const sections = await app.request(
      `/api/v1/courses/${COURSE_ID}/class-sections`,
      { headers: authorization },
    );
    expect(sections.status).toBe(200);
    expect(
      classSectionsResponseSchema.parse(await sections.json()).class_sections,
    ).toHaveLength(1);

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

    const plan = await app.request('/api/v1/admin/catalog/imports/plan', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify(catalogPlanBody()),
    });
    expect(plan.status).toBe(200);
    const planBody = catalogPlanBatchResponseSchema.parse(await plan.json());
    expect(planBody.plan_complete).toBe(true);

    const planStatus = await app.request(
      `/api/v1/admin/catalog/imports/${planBody.import_id}`,
      { headers: authorization },
    );
    expect(planStatus.status).toBe(200);
    expect(
      catalogImportStatusSchema.parse(await planStatus.json()).status,
    ).toBe('planned');

    const upload = await app.request('/api/v1/admin/catalog/imports/upload', {
      method: 'POST',
      headers: authorization,
      body: catalogUploadBody(),
    });
    expect(upload.status).toBe(200);
    const uploadBody = catalogUploadResponseSchema.parse(await upload.json());
    expect(uploadBody.class_section_count).toBe(1);

    const uploadStatus = await app.request(
      `/api/v1/admin/catalog/imports/${uploadBody.import_id}`,
      { headers: authorization },
    );
    expect(uploadStatus.status).toBe(200);
    expect(
      catalogImportStatusSchema.parse(await uploadStatus.json()).status,
    ).toBe('planned');

    const apply = await app.request(
      `/api/v1/admin/catalog/imports/${uploadBody.import_id}/apply-all`,
      {
        method: 'POST',
        headers: { ...authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ confirm_deactivations: true }),
      },
    );
    expect(apply.status).toBe(200);
    const applyBody = catalogApplyResponseSchema.parse(await apply.json());
    expect(applyBody.complete).toBe(true);

    await seedHistoricalMaintainerEvents(client, signedIn.userId);
    const incremental = await app.request('/api/v1/sync', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'incremental',
        cursor: snapshotBody.next_cursor,
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
