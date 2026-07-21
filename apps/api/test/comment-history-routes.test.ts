import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/http/app.js';

const USER_ID = '018f0000-0000-7000-8000-000000003001';
const COMMENT_ID = '018f0000-0000-7000-8000-000000003002';
const REQUEST_ID = '018f0000-0000-7000-8000-000000003003';

function dependencies(maintainer = false) {
  return {
    createRequestId: () => REQUEST_ID,
    checkReady: vi.fn(async () => true),
    comments: {
      authenticate: vi.fn(async () => ({
        user: {
          id: USER_ID,
          username: 'student',
          displayName: 'Student',
          status: 'active' as const,
          profileRevision: 1,
        },
        roles: maintainer ? ['maintainer' as const] : [],
        session: {
          id: '018f0000-0000-7000-8000-000000003004',
          userId: USER_ID,
          tokenHash: 'hash',
          deviceName: null,
          deviceMetadata: {},
          createdAt: new Date('2026-07-19T12:00:00.000Z'),
          lastSeenAt: new Date('2026-07-19T12:00:00.000Z'),
          idleExpiresAt: new Date('2026-08-18T12:00:00.000Z'),
          absoluteExpiresAt: new Date('2027-01-15T12:00:00.000Z'),
          revokedAt: null,
        },
      })),
      rateLimit: vi.fn(async () => undefined),
      list: vi.fn(async () => ({
        comment_id: COMMENT_ID,
        revisions: [],
        next_after_revision: null,
      })),
    },
  };
}

describe('comment history routes', () => {
  it('requires bearer authentication', async () => {
    const response = await createApp(dependencies()).request(
      `/api/v1/comments/${COMMENT_ID}/revisions`,
    );
    expect(response.status).toBe(401);
  });

  it('forwards pagination and fresh maintainer role', async () => {
    const deps = dependencies(true);
    const response = await createApp(deps).request(
      `/api/v1/comments/${COMMENT_ID}/revisions?after_revision=2&limit=25`,
      { headers: { authorization: 'Bearer session-token' } },
    );
    expect(response.status).toBe(200);
    expect(deps.comments.rateLimit).toHaveBeenCalledWith(USER_ID);
    expect(deps.comments.list).toHaveBeenCalledWith({
      commentId: COMMENT_ID,
      userId: USER_ID,
      maintainer: true,
      afterRevision: 2,
      limit: 25,
    });
  });

  it('rejects invalid identifiers and pagination', async () => {
    const app = createApp(dependencies());
    const invalidId = await app.request('/api/v1/comments/not-an-id/revisions', {
      headers: { authorization: 'Bearer session-token' },
    });
    expect(invalidId.status).toBe(400);

    const invalidLimit = await app.request(
      `/api/v1/comments/${COMMENT_ID}/revisions?limit=101`,
      { headers: { authorization: 'Bearer session-token' } },
    );
    expect(invalidLimit.status).toBe(400);
  });
});
