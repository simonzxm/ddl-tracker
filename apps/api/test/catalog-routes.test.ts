import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../src/auth/account-service.js';
import { createApp } from '../src/http/app.js';
import type { CatalogRouteDependencies } from '../src/http/catalog-routes.js';
import { HttpError } from '../src/http/errors.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000000001';
const TERM_ID = '018f0000-0000-7000-8000-000000000002';
const COURSE_ID = '018f0000-0000-7000-8000-000000000003';

const principal: AuthenticatedPrincipal = {
  user: {
    id: '018f0000-0000-7000-8000-000000000004',
    username: 'student',
    displayName: 'Student',
    status: 'active',
    profileRevision: 1,
  },
  session: {
    id: '018f0000-0000-7000-8000-000000000005',
    userId: '018f0000-0000-7000-8000-000000000004',
    tokenHash: 'hidden',
    deviceName: null,
    deviceMetadata: {},
    createdAt: new Date(),
    lastSeenAt: new Date(),
    idleExpiresAt: new Date(Date.now() + 60_000),
    absoluteExpiresAt: new Date(Date.now() + 120_000),
    revokedAt: null,
  },
  roles: [],
};

function dependencies(): CatalogRouteDependencies {
  return {
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
        department: null,
      },
    ]),
    listClassSections: vi.fn(async () => []),
  };
}

function app(catalog: CatalogRouteDependencies) {
  return createApp({
    createRequestId: () => REQUEST_ID,
    checkReady: async () => true,
    catalog,
  });
}

describe('catalog routes', () => {
  it('requires authentication for terms', async () => {
    const response = await app(dependencies()).request('/v1/terms');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('returns terms to an authenticated user', async () => {
    const catalog = dependencies();
    const response = await app(catalog).request('/v1/terms', {
      headers: { authorization: 'Bearer token' },
    });

    expect(response.status).toBe(200);
    expect(catalog.listTerms).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      terms: [{ id: TERM_ID }],
    });
  });

  it('stops before querying when the read allowance is exhausted', async () => {
    const catalog = dependencies();
    catalog.rateLimit = vi.fn(async () => {
      throw new HttpError({
        code: 'rate_limited',
        message: 'Too many requests.',
        retryable: true,
        retryAfter: 12,
        status: 429,
      });
    });
    const response = await app(catalog).request('/v1/terms', {
      headers: { authorization: 'Bearer token' },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(catalog.listTerms).not.toHaveBeenCalled();
  });

  it('scopes course listing to a canonical term ID', async () => {
    const catalog = dependencies();
    const response = await app(catalog).request(
      `/v1/terms/${TERM_ID}/courses`,
      { headers: { authorization: 'Bearer token' } },
    );

    expect(response.status).toBe(200);
    expect(catalog.listCourses).toHaveBeenCalledWith(TERM_ID);
  });

  it('scopes section listing to a canonical course ID', async () => {
    const catalog = dependencies();
    const response = await app(catalog).request(
      `/v1/courses/${COURSE_ID}/class-sections`,
      { headers: { authorization: 'Bearer token' } },
    );

    expect(response.status).toBe(200);
    expect(catalog.listClassSections).toHaveBeenCalledWith(COURSE_ID);
  });

  it('rejects invalid path identifiers before querying', async () => {
    const catalog = dependencies();
    const response = await app(catalog).request('/v1/terms/not-a-uuid/courses', {
      headers: { authorization: 'Bearer token' },
    });

    expect(response.status).toBe(400);
    expect(catalog.listCourses).not.toHaveBeenCalled();
  });
});
