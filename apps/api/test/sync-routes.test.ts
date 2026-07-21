import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../src/auth/account-service.js';
import { createApp } from '../src/http/app.js';
import { HttpError } from '../src/http/errors.js';
import type { SyncRouteDependencies } from '../src/http/sync-routes.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000002401';
const USER_ID = '018f0000-0000-7000-8000-000000002402';
const CURSOR = 'opaque-cursor';

function principal(): AuthenticatedPrincipal {
  const now = new Date();
  return {
    user: {
      id: USER_ID,
      username: 'student',
      displayName: 'Student',
      status: 'active',
      profileRevision: 1,
    },
    session: {
      id: '018f0000-0000-7000-8000-000000002403',
      userId: USER_ID,
      tokenHash: 'hidden',
      deviceName: null,
      deviceMetadata: {},
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 120_000),
      revokedAt: null,
    },
    roles: ['maintainer'],
  };
}

function dependencies(): SyncRouteDependencies & {
  rateLimit: ReturnType<typeof vi.fn>;
  handle: ReturnType<typeof vi.fn>;
} {
  return {
    authenticate: vi.fn(async () => principal()),
    rateLimit: vi.fn(async () => undefined),
    handle: vi.fn(async () => ({
      protocol_version: 1,
      request_id: REQUEST_ID,
      operation_results: [],
      events: [],
      next_cursor: CURSOR,
      has_more: false,
    })),
  };
}

function app(sync: SyncRouteDependencies) {
  return createApp({
    createRequestId: () => REQUEST_ID,
    checkReady: async () => true,
    sync,
  });
}

describe('sync route', () => {
  it('requires bearer authentication', async () => {
    const response = await app(dependencies()).request('/api/v1/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 1,
        mode: 'incremental',
        cursor: CURSOR,
        event_limit: 200,
        operations: [],
      }),
    });

    expect(response.status).toBe(401);
  });

  it('validates and dispatches an incremental request with fresh roles', async () => {
    const deps = dependencies();
    const response = await app(deps).request('/api/v1/sync', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        protocol_version: 1,
        mode: 'incremental',
        cursor: CURSOR,
        event_limit: 200,
        operations: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(deps.handle).toHaveBeenCalledWith({
      userId: USER_ID,
      maintainer: true,
      requestId: REQUEST_ID,
      request: expect.objectContaining({ mode: 'incremental' }),
    });
  });

  it('returns retry metadata before reading or dispatching a limited request', async () => {
    const deps = dependencies();
    deps.rateLimit.mockRejectedValue(
      new HttpError({
        code: 'rate_limited',
        message: 'Too many requests.',
        retryable: true,
        retryAfter: 9,
        status: 429,
      }),
    );
    const response = await app(deps).request('/api/v1/sync', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        protocol_version: 1,
        mode: 'incremental',
        cursor: CURSOR,
        event_limit: 200,
        operations: [],
      }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('9');
    await expect(response.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retry_after: 9,
    });
    expect(deps.rateLimit).toHaveBeenCalledWith(USER_ID);
    expect(deps.handle).not.toHaveBeenCalled();
  });

  it('rejects mixed snapshot and incremental fields', async () => {
    const deps = dependencies();
    const response = await app(deps).request('/api/v1/sync', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        protocol_version: 1,
        mode: 'incremental',
        cursor: CURSOR,
        event_limit: 200,
        snapshot_limit: 200,
        operations: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(deps.handle).not.toHaveBeenCalled();
  });

  it('enforces the actual 512 KiB body limit even without content-length', async () => {
    const deps = dependencies();
    const body = JSON.stringify({
      protocol_version: 1,
      mode: 'incremental',
      cursor: CURSOR,
      event_limit: 200,
      operations: [],
      padding: 'x'.repeat(513 * 1024),
    });
    const response = await app(deps).request('/api/v1/sync', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body,
    });

    expect(response.status).toBe(413);
    expect(deps.handle).not.toHaveBeenCalled();
  });
});
