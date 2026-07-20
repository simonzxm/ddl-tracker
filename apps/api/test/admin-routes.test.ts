import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../src/auth/account-service.js';
import { createApp } from '../src/http/app.js';
import type { AdminRouteDependencies } from '../src/http/admin-routes.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000003501';
const USER_ID = '018f0000-0000-7000-8000-000000003502';
const TARGET_ID = '018f0000-0000-7000-8000-000000003503';
const REPORT_ID = '018f0000-0000-7000-8000-000000003504';

function principal(maintainer: boolean): AuthenticatedPrincipal {
  return {
    user: {
      id: USER_ID,
      username: 'student',
      displayName: 'Student',
      status: 'active',
      profileRevision: 1,
    },
    session: {
      id: '018f0000-0000-7000-8000-000000003505',
      userId: USER_ID,
      tokenHash: 'hidden',
      deviceName: null,
      deviceMetadata: {},
      createdAt: new Date(),
      lastSeenAt: new Date(),
      idleExpiresAt: new Date(Date.now() + 60_000),
      absoluteExpiresAt: new Date(Date.now() + 120_000),
      revokedAt: null,
    },
    roles: maintainer ? ['maintainer'] : [],
  };
}

function dependencies(maintainer = true): AdminRouteDependencies {
  return {
    authenticate: vi.fn(async () => principal(maintainer)),
    rateLimitRead: vi.fn(async () => undefined),
    rateLimitMutation: vi.fn(async () => undefined),
    bootstrap: vi.fn(async () => ({ maintainer: true as const })),
    setContentHidden: vi.fn(async (input) => ({
      state: input.hidden ? ('hidden' as const) : ('visible' as const),
      revision: 2,
      changed: true,
    })),
    listReports: vi.fn(async () => ({ reports: [], next: null })),
    resolveReport: vi.fn(async (input) => ({ status: input.status })),
    setUserSuspended: vi.fn(async (input) => ({
      status: input.suspended ? ('suspended' as const) : ('active' as const),
      changed: true,
    })),
    setMaintainerRole: vi.fn(async (input) => ({
      maintainer: input.maintainer,
      changed: true,
    })),
    listAudit: vi.fn(async () => ({ entries: [], next: null })),
    mergeTask: vi.fn(async () => ({
      source_task_id: TARGET_ID,
      target_task_id: REPORT_ID,
      redirected_proposals: 0,
      moved_proposals: 1,
      recovered_personal_todos: 0,
    })),
  };
}

function app(admin: AdminRouteDependencies) {
  return createApp({
    createRequestId: () => REQUEST_ID,
    checkReady: async () => true,
    admin,
  });
}

const jsonHeaders = {
  authorization: 'Bearer token',
  'content-type': 'application/json',
};

describe('maintainer routes', () => {
  it('allows an authenticated non-maintainer to attempt bootstrap', async () => {
    const deps = dependencies(false);
    const response = await app(deps).request('/v1/admin/bootstrap', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ bootstrap_token: 'one-time-secret' }),
    });
    expect(response.status).toBe(200);
    expect(deps.rateLimitMutation).toHaveBeenCalledWith(USER_ID);
    expect(deps.bootstrap).toHaveBeenCalledWith({
      actorId: USER_ID,
      requestId: REQUEST_ID,
      bootstrapToken: 'one-time-secret',
    });
  });

  it('requires a fresh maintainer role for management operations', async () => {
    const response = await app(dependencies(false)).request(
      `/v1/admin/users/${TARGET_ID}/suspend`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ reason: 'Investigate.' }),
      },
    );
    expect(response.status).toBe(403);
  });

  it('maps content hide and report resolution requests with request IDs', async () => {
    const deps = dependencies();
    const hidden = await app(deps).request(
      `/v1/admin/content/${TARGET_ID}/hide`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          target_type: 'proposal',
          reason: 'Confirmed inaccurate.',
        }),
      },
    );
    expect(hidden.status).toBe(200);
    expect(deps.setContentHidden).toHaveBeenCalledWith({
      actorId: USER_ID,
      targetType: 'proposal',
      targetId: TARGET_ID,
      hidden: true,
      reason: 'Confirmed inaccurate.',
      requestId: REQUEST_ID,
    });

    const resolved = await app(deps).request(
      `/v1/admin/reports/${REPORT_ID}/resolve`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          status: 'resolved',
          resolution: 'Content hidden.',
        }),
      },
    );
    expect(resolved.status).toBe(200);
    expect(deps.resolveReport).toHaveBeenCalledWith({
      actorId: USER_ID,
      reportId: REPORT_ID,
      status: 'resolved',
      resolution: 'Content hidden.',
      requestId: REQUEST_ID,
    });
  });

  it('maps user status and role mutations', async () => {
    const deps = dependencies();
    const suspended = await app(deps).request(
      `/v1/admin/users/${TARGET_ID}/suspend`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ reason: 'Repeated abuse.' }),
      },
    );
    expect(suspended.status).toBe(200);
    expect(deps.setUserSuspended).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: TARGET_ID, suspended: true }),
    );

    const role = await app(deps).request(
      `/v1/admin/users/${TARGET_ID}/roles`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          maintainer: true,
          reason: 'On-call rotation.',
        }),
      },
    );
    expect(role.status).toBe(200);
    expect(deps.setMaintainerRole).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: TARGET_ID, maintainer: true }),
    );
  });

  it('maps task merge commands with the actual request ID', async () => {
    const deps = dependencies();
    const response = await app(deps).request(
      `/v1/admin/tasks/${TARGET_ID}/merge`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          target_task_id: REPORT_ID,
          reason: 'Confirmed duplicate.',
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(deps.mergeTask).toHaveBeenCalledWith({
      actorId: USER_ID,
      sourceTaskId: TARGET_ID,
      targetTaskId: REPORT_ID,
      reason: 'Confirmed duplicate.',
      requestId: REQUEST_ID,
    });
  });

  it('validates report and audit query bounds', async () => {
    const deps = dependencies();
    const reports = await app(deps).request('/v1/admin/reports?status=open&limit=20', {
      headers: { authorization: 'Bearer token' },
    });
    expect(reports.status).toBe(200);
    expect(deps.rateLimitRead).toHaveBeenCalledWith(USER_ID);
    expect(deps.listReports).toHaveBeenCalledWith({ status: 'open', limit: 20 });

    const invalid = await app(deps).request('/v1/admin/audit?limit=101', {
      headers: { authorization: 'Bearer token' },
    });
    expect(invalid.status).toBe(400);
  });
});
