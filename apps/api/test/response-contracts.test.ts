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
        roles: ['maintainer'] as 'maintainer'[],
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

interface BodylessCase {
  name: string;
  method: string;
  path: string;
  status: number;
  init?: RequestInit;
}

const bodylessCases: BodylessCase[] = [
  {
    name: 'OIDC callback redirect',
    method: 'GET',
    path: '/api/v1/auth/oidc/callback?state=state&code=provider-code',
    status: 302,
    init: { redirect: 'manual' },
  },
  {
    name: 'account deletion',
    method: 'DELETE',
    path: '/api/v1/me',
    status: 204,
    init: { method: 'DELETE', headers: AUTHORIZATION },
  },
  {
    name: 'single session revocation',
    method: 'DELETE',
    path: `/api/v1/sessions/${SESSION_ID}`,
    status: 204,
    init: { method: 'DELETE', headers: AUTHORIZATION },
  },
  {
    name: 'all session revocation',
    method: 'DELETE',
    path: '/api/v1/sessions',
    status: 204,
    init: { method: 'DELETE', headers: AUTHORIZATION },
  },
];

const openApiCase = {
  method: 'GET',
  path: '/api/openapi.json',
} as const;

interface RegisteredRoute {
  method: string;
  path: string;
}

const HTTP_METHODS = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
]);

function documentedRoutes(): string[] {
  const routes: string[] = [];
  for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
    for (const method of Object.keys(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      routes.push(
        `${method.toUpperCase()} /api${path.replace(/\{([^}]+)\}/gu, ':$1')}`,
      );
    }
  }
  return routes.sort();
}

function pathname(path: string): string {
  return new URL(path, 'https://api.example').pathname;
}

function routeMatchesRequest(
  route: RegisteredRoute,
  request: { method: string; path: string },
): boolean {
  if (route.method !== request.method) return false;
  const pattern = route.path
    .split('/')
    .map((segment) =>
      segment.startsWith(':')
        ? '[^/]+'
        : segment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`, 'u').test(pathname(request.path));
}

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
    const response = await createApp(dependencies()).request(openApiCase.path);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(openApiDocument);
  });

  it('keeps redirects and empty success responses bodyless', async () => {
    const app = createApp(dependencies());
    for (const testCase of bodylessCases) {
      const response = await app.request(testCase.path, testCase.init);
      expect(response.status, testCase.name).toBe(testCase.status);
      expect(await response.text(), testCase.name).toBe('');
    }
  });

  it('executes a contract classification for every registered public route', () => {
    const actualRoutes = createApp(dependencies()).routes.filter(
      (route) => route.method !== 'ALL',
    );
    const classifiedRequests = [
      ...jsonCases,
      ...bodylessCases,
      openApiCase,
    ];

    for (const route of actualRoutes) {
      expect(
        classifiedRequests.some((request) =>
          routeMatchesRequest(route, request),
        ),
        `${route.method} ${route.path}`,
      ).toBe(true);
    }
    for (const request of classifiedRequests) {
      expect(
        actualRoutes.filter((route) => routeMatchesRequest(route, request)),
        `${request.method} ${pathname(request.path)}`,
      ).toHaveLength(1);
    }

    const implementedDocumentedRoutes = actualRoutes
      .filter((route) => route.path !== openApiCase.path)
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(documentedRoutes()).toEqual(implementedDocumentedRoutes);
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

    for (const errorCase of [
      { status: 403, code: 'forbidden' as const },
      { status: 409, code: 'conflict' as const },
      { status: 429, code: 'rate_limited' as const, retryAfter: 5 },
      { status: 503, code: 'temporarily_unavailable' as const },
    ]) {
      const errorDependencies = dependencies();
      const errorCatalog = errorDependencies.catalog;
      if (errorCatalog === undefined) {
        throw new Error('Catalog dependencies are required by this fixture.');
      }
      errorCatalog.rateLimit = vi.fn(async () => {
        throw new HttpError({
          code: errorCase.code,
          message: 'Request rejected.',
          retryable: errorCase.status >= 429,
          ...(errorCase.retryAfter === undefined
            ? {}
            : { retryAfter: errorCase.retryAfter }),
          status: errorCase.status,
        });
      });
      const response = await createApp(errorDependencies).request(
        '/api/v1/terms',
        { headers: AUTHORIZATION },
      );
      expect(response.status).toBe(errorCase.status);
      expect(apiErrorSchema.parse(await response.json())).toMatchObject({
        code: errorCase.code,
        ...(errorCase.retryAfter === undefined
          ? {}
          : { retry_after: errorCase.retryAfter }),
      });
    }

    const unsupported = await createApp(dependencies()).request('/api/v1/sync', {
      method: 'POST',
      headers: { ...AUTHORIZATION, 'content-type': 'text/plain' },
      body: 'not json',
    });
    expect(unsupported.status).toBe(415);
    expect(apiErrorSchema.parse(await unsupported.json()).code).toBe(
      'unsupported_media_type',
    );

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

  it('fails closed when a dependency adds or omits response fields', async () => {
    const extraDependencies = dependencies();
    const extraAuth = extraDependencies.auth;
    if (extraAuth === undefined) {
      throw new Error('Authentication dependencies are required by this fixture.');
    }
    extraAuth.beginOidcAuthorization = vi.fn(async () => ({
      authorization_url: 'https://issuer.example/authorize',
      expires_at: TIMESTAMP,
      internal_only: true,
    }));
    const extra = await createApp(extraDependencies).request(
      '/api/v1/auth/oidc/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: 'ddltracker.mac://auth/callback',
        }),
      },
    );
    expect(extra.status).toBe(500);
    expect(apiErrorSchema.parse(await extra.json())).toEqual({
      code: 'internal_error',
      details: {},
      message: 'An internal error occurred.',
      retryable: true,
      request_id: REQUEST_ID,
    });

    const missingDependencies = dependencies();
    const missingCatalog = missingDependencies.catalog;
    if (missingCatalog === undefined) {
      throw new Error('Catalog dependencies are required by this fixture.');
    }
    const incompleteTerm = {
      id: TERM_ID,
      external_code: '2026-2027-1',
      name: 'Term',
      starts_on: '2026-08-31',
      ends_on: '2027-01-17',
      status: 'upcoming' as const,
    };
    Reflect.deleteProperty(incompleteTerm, 'status');
    missingCatalog.listTerms = vi.fn(async () => [incompleteTerm]);
    const omitted = await createApp(missingDependencies).request('/api/v1/terms', {
      headers: AUTHORIZATION,
    });
    expect(omitted.status).toBe(500);
    expect(apiErrorSchema.parse(await omitted.json())).toMatchObject({
      code: 'internal_error',
      message: 'An internal error occurred.',
    });
  });
});
