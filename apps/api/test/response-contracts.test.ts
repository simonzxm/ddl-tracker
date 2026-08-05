import { gzipSync } from 'node:zlib';

import {
  adminAuditPageSchema,
  adminBootstrapResponseSchema,
  adminContentActionResponseSchema,
  adminReportPageSchema,
  adminReportResolutionResponseSchema,
  adminRoleResponseSchema,
  adminTaskMergeResponseSchema,
  adminUserActionResponseSchema,
  apiErrorSchema,
  catalogApplyResponseSchema,
  catalogCancelResponseSchema,
  catalogImportStatusSchema,
  catalogPlanBatchResponseSchema,
  catalogUploadResponseSchema,
  classSectionsResponseSchema,
  commentRevisionPageSchema,
  coursesResponseSchema,
  currentUserSchema,
  healthResponseSchema,
  oidcAuthorizationResponseSchema,
  sessionListResponseSchema,
  sessionVerificationResponseSchema,
  syncResponseSchema,
  termsResponseSchema,
  type SyncResponse,
} from '@ddl-tracker/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';

import type {
  AuthenticatedPrincipal,
  PublicUser,
  SessionRecord,
} from '../src/auth/account-service.js';
import { createApp, type AppDependencies } from '../src/http/app.js';
import { HttpError } from '../src/http/errors.js';
import { openApiDocument } from '../src/openapi.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000009001';
const USER_ID = '018f0000-0000-7000-8000-000000009002';
const SESSION_ID = '018f0000-0000-7000-8000-000000009003';
const TERM_ID = '018f0000-0000-7000-8000-000000009004';
const COURSE_ID = '018f0000-0000-7000-8000-000000009005';
const SECTION_ID = '018f0000-0000-7000-8000-000000009006';
const COMMENT_ID = '018f0000-0000-7000-8000-000000009007';
const IMPORT_ID = '018f0000-0000-7000-8000-000000009008';
const REPORT_ID = '018f0000-0000-7000-8000-000000009009';
const TARGET_ID = '018f0000-0000-7000-8000-000000009010';
const AUDIT_ID = '018f0000-0000-7000-8000-000000009011';
const TIMESTAMP = '2026-08-05T07:00:00.000Z';
const HASH = 'a'.repeat(64);
const AUTHORIZATION = { authorization: 'Bearer session-token' };
const JSON_HEADERS = {
  ...AUTHORIZATION,
  'content-type': 'application/json',
};

const user: PublicUser = {
  id: USER_ID,
  username: 'student_123',
  displayName: 'Student',
  avatarUrl: null,
  bio: null,
  status: 'active',
  profileRevision: 1,
};

const session: SessionRecord = {
  id: SESSION_ID,
  userId: USER_ID,
  tokenHash: 'hash',
  deviceName: 'MacBook',
  deviceMetadata: { platform: 'macos' },
  createdAt: new Date(TIMESTAMP),
  lastSeenAt: new Date(TIMESTAMP),
  idleExpiresAt: new Date(TIMESTAMP),
  absoluteExpiresAt: new Date(TIMESTAMP),
  revokedAt: null,
};

const principal: AuthenticatedPrincipal = {
  user,
  session,
  roles: ['maintainer'],
};

const emptyDiff = {
  terms: { added: 0, updated: 0, unchanged: 1, deactivated: 0 },
  courses: { added: 0, updated: 0, unchanged: 1, deactivated: 0 },
  class_sections: { added: 0, updated: 0, unchanged: 1, deactivated: 0 },
  field_changes: {},
  deactivated_courses: [],
  deactivated_class_sections: [],
  deactivated_class_section_ids: [],
  checksum_previously_applied: false,
};

function syncResponse(mode: string): SyncResponse {
  switch (mode) {
    case 'account_snapshot':
      return {
        protocol_version: 2,
        mode,
        request_id: REQUEST_ID,
        records: [],
        snapshot_token: 'snapshot-token',
        next_page_token: null,
        snapshot_complete: true,
        next_cursor: 'next-cursor',
      };
    case 'class_section_snapshot':
      return {
        protocol_version: 2,
        mode,
        class_section_id: SECTION_ID,
        request_id: REQUEST_ID,
        records: [],
        snapshot_token: 'snapshot-token',
        next_page_token: null,
        snapshot_complete: true,
        resume_cursor: 'resume-cursor',
      };
    default:
      return {
        protocol_version: 2,
        mode: 'incremental',
        request_id: REQUEST_ID,
        operation_results: [],
        events: [],
        next_cursor: 'next-cursor',
        has_more: false,
      };
  }
}

function dependencies(): AppDependencies {
  return {
    createRequestId: () => REQUEST_ID,
    checkReady: async () => true,
    auth: {
      beginOidcAuthorization: vi.fn(async () => ({
        authorization_url: 'https://issuer.example/authorize',
        expires_at: TIMESTAMP,
      })),
      completeOidcAuthorization: vi.fn(async () => ({
        kind: 'success' as const,
        redirectUri: 'ddltracker.mac://auth/callback',
        exchangeCode: 'one-time-code',
      })),
      exchangeOidcAuthorization: vi.fn(async () => ({
        kind: 'session' as const,
        access_token: 'session-token',
        token_type: 'Bearer' as const,
        expires_at: TIMESTAMP,
        user,
        roles: ['maintainer'] as const,
      })),
      authenticate: vi.fn(async () => principal),
      rateLimit: vi.fn(async () => undefined),
      listSessions: vi.fn(async () => [session]),
      revokeSession: vi.fn(async () => true),
      revokeAllSessions: vi.fn(async () => 1),
      updateProfile: vi.fn(async (_userId, input) => ({
        ...user,
        username: input.username,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        bio: input.bio,
        profileRevision: input.expectedRevision + 1,
      })),
      deleteAccount: vi.fn(async () => undefined),
    },
    catalog: {
      authenticate: vi.fn(async () => principal),
      rateLimit: vi.fn(async () => undefined),
      listTerms: vi.fn(async () => [
        {
          id: TERM_ID,
          external_code: '2026-2027-1',
          name: 'Term',
          starts_on: '2026-08-31',
          ends_on: '2027-01-17',
          status: 'upcoming' as const,
        },
      ]),
      listCourses: vi.fn(async () => [
        {
          id: COURSE_ID,
          external_course_code: '001',
          name: 'Course',
          credits: '3.00',
        },
      ]),
      listClassSections: vi.fn(async () => [
        {
          id: SECTION_ID,
          external_section_id: 'section-1',
          section_number: '01',
          department_code: null,
          department_name: null,
          instructors: ['Teacher'],
          campus: null,
          capacity: 100,
          schedule_text: null,
          active: true,
          revision: 1,
        },
      ]),
    },
    comments: {
      authenticate: vi.fn(async () => principal),
      rateLimit: vi.fn(async () => undefined),
      list: vi.fn(async () => ({
        comment_id: COMMENT_ID,
        revisions: [
          {
            revision: 1,
            body: 'Comment body',
            author_id: USER_ID,
            created_at: TIMESTAMP,
          },
        ],
        next_after_revision: null,
      })),
    },
    sync: {
      authenticate: vi.fn(async () => principal),
      rateLimit: vi.fn(async () => undefined),
      handle: vi.fn(async ({ request }) => syncResponse(request.mode)),
    },
    adminCatalog: {
      environment: 'production',
      authenticate: vi.fn(async () => principal),
      rateLimitRead: vi.fn(async () => undefined),
      rateLimitMutation: vi.fn(async () => undefined),
      planBatch: vi.fn(async () => ({
        import_id: IMPORT_ID,
        batch_index: 0,
        accepted: true,
        received_batches: 1,
        total_batches: 1,
        plan_complete: true,
        diff: emptyDiff,
      })),
      upload: vi.fn(async () => ({
        import_id: IMPORT_ID,
        replayed: false,
        filename: 'catalog.csv.gz',
        checksum: HASH,
        manifest_hash: HASH,
        row_count: 1,
        course_count: 1,
        class_section_count: 1,
        total_batches: 1,
        warnings: [],
        diff: emptyDiff,
      })),
      applyAll: vi.fn(async () => ({
        import_id: IMPORT_ID,
        replayed: false,
        applied_batches: 1,
        total_batches: 1,
        complete: true,
      })),
      cancel: vi.fn(async () => ({
        import_id: IMPORT_ID,
        status: 'cancelled' as const,
        replayed: false,
      })),
      getStatus: vi.fn(async () => ({
        import_id: IMPORT_ID,
        status: 'planned' as const,
        received_batches: 1,
        applied_batches: 0,
        total_batches: 1,
        diff: null,
        failure_message: null,
      })),
    },
    admin: {
      authenticate: vi.fn(async () => principal),
      rateLimitRead: vi.fn(async () => undefined),
      rateLimitMutation: vi.fn(async () => undefined),
      bootstrap: vi.fn(async () => ({ maintainer: true as const })),
      setContentHidden: vi.fn(async ({ hidden }) => ({
        state: hidden ? ('hidden' as const) : ('visible' as const),
        revision: 2,
        changed: true,
      })),
      listReports: vi.fn(async () => ({
        reports: [
          {
            id: REPORT_ID,
            reporter_id: USER_ID,
            target_type: 'comment' as const,
            target_id: COMMENT_ID,
            reason: 'other' as const,
            details: 'Needs review.',
            status: 'open' as const,
            resolution: null,
            resolved_by: null,
            created_at: TIMESTAMP,
            resolved_at: null,
          },
        ],
        next: null,
      })),
      resolveReport: vi.fn(async ({ status }) => ({ status })),
      setUserSuspended: vi.fn(async ({ suspended }) => ({
        status: suspended ? ('suspended' as const) : ('active' as const),
        changed: true,
      })),
      setMaintainerRole: vi.fn(async ({ maintainer }) => ({
        maintainer,
        changed: true,
      })),
      listAudit: vi.fn(async () => ({
        entries: [
          {
            id: AUDIT_ID,
            actor_id: USER_ID,
            action: 'comment_hidden',
            target_type: 'comment',
            target_id: COMMENT_ID,
            reason: 'Needs review.',
            result: { state: 'hidden' },
            request_id: REQUEST_ID,
            created_at: TIMESTAMP,
          },
        ],
        next: null,
      })),
      mergeTask: vi.fn(async () => ({
        source_task_id: TARGET_ID,
        target_task_id: COMMENT_ID,
        redirected_proposals: 0,
        moved_proposals: 1,
        recovered_personal_todos: 0,
      })),
    },
  };
}

function planBody() {
  return {
    import_id: null,
    filename: 'fixture.csv',
    checksum: HASH,
    header_hash: HASH,
    manifest_hash: HASH,
    environment: 'production',
    manifest: { schema_version: 1 },
    term: {
      external_code: '2026-2027-1',
      display_name: 'Term',
      starts_on: '2026-08-31',
      ends_on: '2027-01-17',
      time_zone: 'Asia/Shanghai',
    },
    row_count: 0,
    batch_index: 0,
    total_batches: 1,
    finalize: true,
    courses: [],
    class_sections: [],
  };
}

function uploadBody(): FormData {
  const form = new FormData();
  form.set('catalog', new Blob([gzipSync('header\nvalue\n')]), 'catalog.csv.gz');
  form.set('manifest', '{"schema_version":1}');
  return form;
}

interface JsonCase {
  name: string;
  method: string;
  path: string;
  schema: ZodType;
  init?: RequestInit;
}

const jsonCases: JsonCase[] = [
  { name: 'liveness', method: 'GET', path: '/api/health/live', schema: healthResponseSchema },
  { name: 'readiness', method: 'GET', path: '/api/health/ready', schema: healthResponseSchema },
  {
    name: 'OIDC start',
    method: 'POST',
    path: '/api/v1/auth/oidc/start',
    schema: oidcAuthorizationResponseSchema,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uri: 'ddltracker.mac://auth/callback' }),
    },
  },
  {
    name: 'OIDC exchange',
    method: 'POST',
    path: '/api/v1/auth/oidc/exchange',
    schema: sessionVerificationResponseSchema,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'one-time-code' }),
    },
  },
  { name: 'current user', method: 'GET', path: '/api/v1/me', schema: currentUserSchema, init: { headers: AUTHORIZATION } },
  {
    name: 'profile update',
    method: 'PATCH',
    path: '/api/v1/me/profile',
    schema: currentUserSchema,
    init: {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        username: 'student_456',
        display_name: 'Student Two',
        avatar_url: null,
        bio: null,
        expected_revision: 1,
      }),
    },
  },
  { name: 'session list', method: 'GET', path: '/api/v1/sessions', schema: sessionListResponseSchema, init: { headers: AUTHORIZATION } },
  { name: 'terms', method: 'GET', path: '/api/v1/terms', schema: termsResponseSchema, init: { headers: AUTHORIZATION } },
  { name: 'courses', method: 'GET', path: `/api/v1/terms/${TERM_ID}/courses`, schema: coursesResponseSchema, init: { headers: AUTHORIZATION } },
  { name: 'class sections', method: 'GET', path: `/api/v1/courses/${COURSE_ID}/class-sections`, schema: classSectionsResponseSchema, init: { headers: AUTHORIZATION } },
  { name: 'comment revisions', method: 'GET', path: `/api/v1/comments/${COMMENT_ID}/revisions`, schema: commentRevisionPageSchema, init: { headers: AUTHORIZATION } },
  {
    name: 'incremental sync',
    method: 'POST',
    path: '/api/v1/sync',
    schema: syncResponseSchema,
    init: {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'incremental',
        cursor: 'cursor',
        event_limit: 10,
        operations: [],
      }),
    },
  },
  {
    name: 'account snapshot sync',
    method: 'POST',
    path: '/api/v1/sync',
    schema: syncResponseSchema,
    init: {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'account_snapshot',
        snapshot_token: null,
        page_token: null,
        snapshot_limit: 10,
        operations: [],
      }),
    },
  },
  {
    name: 'class section snapshot sync',
    method: 'POST',
    path: '/api/v1/sync',
    schema: syncResponseSchema,
    init: {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        protocol_version: 2,
        mode: 'class_section_snapshot',
        cursor: 'cursor',
        class_section_id: SECTION_ID,
        snapshot_token: null,
        page_token: null,
        snapshot_limit: 10,
        operations: [],
      }),
    },
  },
  {
    name: 'catalog import plan',
    method: 'POST',
    path: '/api/v1/admin/catalog/imports/plan',
    schema: catalogPlanBatchResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(planBody()) },
  },
  {
    name: 'catalog upload',
    method: 'POST',
    path: '/api/v1/admin/catalog/imports/upload',
    schema: catalogUploadResponseSchema,
    init: { method: 'POST', headers: AUTHORIZATION, body: uploadBody() },
  },
  {
    name: 'catalog apply',
    method: 'POST',
    path: `/api/v1/admin/catalog/imports/${IMPORT_ID}/apply-all`,
    schema: catalogApplyResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ confirm_deactivations: true }) },
  },
  {
    name: 'catalog cancel',
    method: 'POST',
    path: `/api/v1/admin/catalog/imports/${IMPORT_ID}/cancel`,
    schema: catalogCancelResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ reason: 'Superseded.' }) },
  },
  { name: 'catalog status', method: 'GET', path: `/api/v1/admin/catalog/imports/${IMPORT_ID}`, schema: catalogImportStatusSchema, init: { headers: AUTHORIZATION } },
  {
    name: 'admin bootstrap',
    method: 'POST',
    path: '/api/v1/admin/bootstrap',
    schema: adminBootstrapResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ bootstrap_token: 'secret' }) },
  },
  { name: 'admin reports', method: 'GET', path: '/api/v1/admin/reports', schema: adminReportPageSchema, init: { headers: AUTHORIZATION } },
  {
    name: 'admin report resolution',
    method: 'POST',
    path: `/api/v1/admin/reports/${REPORT_ID}/resolve`,
    schema: adminReportResolutionResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ status: 'resolved', resolution: 'Handled.' }) },
  },
  ...(['hide', 'restore'] as const).map((action): JsonCase => ({
    name: `admin content ${action}`,
    method: 'POST',
    path: `/api/v1/admin/content/${TARGET_ID}/${action}`,
    schema: adminContentActionResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ target_type: 'comment', reason: 'Reviewed.' }) },
  })),
  ...(['suspend', 'restore'] as const).map((action): JsonCase => ({
    name: `admin user ${action}`,
    method: 'POST',
    path: `/api/v1/admin/users/${TARGET_ID}/${action}`,
    schema: adminUserActionResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ reason: 'Reviewed.' }) },
  })),
  {
    name: 'admin role',
    method: 'POST',
    path: `/api/v1/admin/users/${TARGET_ID}/roles`,
    schema: adminRoleResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ maintainer: true, reason: 'Rotation.' }) },
  },
  {
    name: 'admin task merge',
    method: 'POST',
    path: `/api/v1/admin/tasks/${TARGET_ID}/merge`,
    schema: adminTaskMergeResponseSchema,
    init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ target_task_id: COMMENT_ID, reason: 'Duplicate.' }) },
  },
  { name: 'admin audit', method: 'GET', path: '/api/v1/admin/audit', schema: adminAuditPageSchema, init: { headers: AUTHORIZATION } },
];

const expectedRoutes = [
  'GET /api/health/live',
  'GET /api/openapi.json',
  'GET /api/health/ready',
  'POST /api/v1/auth/oidc/start',
  'GET /api/v1/auth/oidc/callback',
  'POST /api/v1/auth/oidc/exchange',
  'GET /api/v1/me',
  'PATCH /api/v1/me/profile',
  'DELETE /api/v1/me',
  'GET /api/v1/sessions',
  'DELETE /api/v1/sessions/:session_id',
  'DELETE /api/v1/sessions',
  'GET /api/v1/terms',
  'GET /api/v1/terms/:term_id/courses',
  'GET /api/v1/courses/:course_id/class-sections',
  'GET /api/v1/comments/:comment_id/revisions',
  'POST /api/v1/sync',
  'POST /api/v1/admin/catalog/imports/plan',
  'POST /api/v1/admin/catalog/imports/upload',
  'POST /api/v1/admin/catalog/imports/:import_id/apply-all',
  'POST /api/v1/admin/catalog/imports/:import_id/cancel',
  'GET /api/v1/admin/catalog/imports/:import_id',
  'POST /api/v1/admin/bootstrap',
  'GET /api/v1/admin/reports',
  'POST /api/v1/admin/reports/:report_id/resolve',
  'POST /api/v1/admin/content/:content_id/hide',
  'POST /api/v1/admin/content/:content_id/restore',
  'POST /api/v1/admin/users/:user_id/suspend',
  'POST /api/v1/admin/users/:user_id/restore',
  'POST /api/v1/admin/users/:user_id/roles',
  'POST /api/v1/admin/tasks/:source_task_id/merge',
  'GET /api/v1/admin/audit',
].sort();

describe('HTTP response contract coverage', () => {
  for (const testCase of jsonCases) {
    it(`${testCase.name} returns exactly its public schema`, async () => {
      const response = await createApp(dependencies()).request(
        testCase.path,
        testCase.init,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const body: unknown = await response.json();
      expect(testCase.schema.parse(body)).toEqual(body);
    });
  }

  it('serves the exact generated OpenAPI document', async () => {
    const response = await createApp(dependencies()).request('/api/openapi.json');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(openApiDocument);
  });

  it('keeps redirects and empty success responses bodyless', async () => {
    const app = createApp(dependencies());
    const redirect = await app.request(
      '/api/v1/auth/oidc/callback?state=state&code=provider-code',
      { redirect: 'manual' },
    );
    expect(redirect.status).toBe(302);
    expect(await redirect.text()).toBe('');

    for (const request of [
      ['/api/v1/me', { method: 'DELETE', headers: AUTHORIZATION }],
      [`/api/v1/sessions/${SESSION_ID}`, { method: 'DELETE', headers: AUTHORIZATION }],
      ['/api/v1/sessions', { method: 'DELETE', headers: AUTHORIZATION }],
    ] as const) {
      const response = await app.request(request[0], request[1]);
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    }
  });

  it('has a contract test classification for every registered public route', () => {
    const actualRoutes = createApp(dependencies()).routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(actualRoutes).toEqual(expectedRoutes);
  });

  it('uses the strict API error envelope across error classes', async () => {
    const invalid = await createApp(dependencies()).request(
      '/api/v1/terms/not-a-uuid/courses',
      { headers: AUTHORIZATION },
    );
    expect(invalid.status).toBe(400);
    expect(apiErrorSchema.parse(await invalid.json())).toMatchObject({
      code: 'invalid_request',
      request_id: REQUEST_ID,
    });

    const unauthenticated = await createApp(dependencies()).request('/api/v1/me');
    expect(unauthenticated.status).toBe(401);
    expect(apiErrorSchema.parse(await unauthenticated.json()).code).toBe(
      'unauthenticated',
    );

    const limitedDependencies = dependencies();
    const limitedCatalog = limitedDependencies.catalog;
    if (limitedCatalog === undefined) {
      throw new Error('Catalog dependencies are required by this fixture.');
    }
    limitedCatalog.rateLimit = vi.fn(async () => {
      throw new HttpError({
        code: 'rate_limited',
        message: 'Too many requests.',
        retryable: true,
        retryAfter: 5,
        status: 429,
      });
    });
    const limited = await createApp(limitedDependencies).request('/api/v1/terms', {
      headers: AUTHORIZATION,
    });
    expect(limited.status).toBe(429);
    expect(apiErrorSchema.parse(await limited.json())).toMatchObject({
      code: 'rate_limited',
      retry_after: 5,
    });

    const failingDependencies = dependencies();
    const failingAuth = failingDependencies.auth;
    if (failingAuth === undefined) {
      throw new Error('Authentication dependencies are required by this fixture.');
    }
    failingAuth.authenticate = vi.fn(async () => {
      throw new Error('private database detail');
    });
    const failed = await createApp(failingDependencies).request('/api/v1/me', {
      headers: AUTHORIZATION,
    });
    expect(failed.status).toBe(500);
    expect(apiErrorSchema.parse(await failed.json())).toMatchObject({
      code: 'internal_error',
      message: 'An internal error occurred.',
    });

    const missing = await createApp(dependencies()).request('/outside-api');
    expect(missing.status).toBe(404);
    expect(apiErrorSchema.parse(await missing.json()).code).toBe('not_found');
  });
});
