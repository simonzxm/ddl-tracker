import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../src/auth/account-service.js';
import { createApp } from '../src/http/app.js';
import type { AdminCatalogRouteDependencies } from '../src/http/admin-catalog-routes.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000000901';
const USER_ID = '018f0000-0000-7000-8000-000000000902';
const IMPORT_ID = '018f0000-0000-7000-8000-000000000903';
const HASH = 'a'.repeat(64);

function principal(maintainer: boolean): AuthenticatedPrincipal {
  return {
    user: {
      id: USER_ID,
      username: 'maintainer',
      displayName: 'Maintainer',
      status: 'active',
      profileRevision: 1,
    },
    session: {
      id: '018f0000-0000-7000-8000-000000000904',
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

function dependencies(maintainer = true): AdminCatalogRouteDependencies {
  return {
    environment: 'staging',
    authenticate: vi.fn(async () => principal(maintainer)),
    rateLimitRead: vi.fn(async () => undefined),
    rateLimitMutation: vi.fn(async () => undefined),
    planBatch: vi.fn(async () => ({
      import_id: IMPORT_ID,
      batch_index: 0,
      accepted: true,
      received_batches: 1,
      total_batches: 1,
      plan_complete: true,
      diff: {
        terms: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
        courses: { added: 0, updated: 0, unchanged: 0, deactivated: 0 },
        class_sections: {
          added: 0,
          updated: 0,
          unchanged: 0,
          deactivated: 0,
        },
        field_changes: {},
        deactivated_courses: [],
        deactivated_class_sections: [],
        deactivated_class_section_ids: [],
        checksum_previously_applied: false,
      },
    })),
    upload: vi.fn(async () => ({
      import_id: IMPORT_ID,
      filename: 'courses.csv.gz',
      checksum: HASH,
      manifest_hash: HASH,
      row_count: 1,
      course_count: 1,
      class_section_count: 1,
      total_batches: 1,
      warnings: [],
      diff: {
        terms: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
        courses: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
        class_sections: {
          added: 1,
          updated: 0,
          unchanged: 0,
          deactivated: 0,
        },
        field_changes: {},
        deactivated_courses: [],
        deactivated_class_sections: [],
        deactivated_class_section_ids: [],
        checksum_previously_applied: false,
      },
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
  };
}

function planBody(environment = 'staging') {
  return {
    import_id: null,
    filename: 'fixture.csv',
    checksum: HASH,
    header_hash: HASH,
    manifest_hash: HASH,
    environment,
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

function app(adminCatalog: AdminCatalogRouteDependencies) {
  return createApp({
    createRequestId: () => REQUEST_ID,
    checkReady: async () => true,
    adminCatalog,
  });
}

describe('admin catalog routes', () => {
  it('requires a fresh maintainer role', async () => {
    const response = await app(dependencies(false)).request(
      '/api/v1/admin/catalog/imports/plan',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(planBody()),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'forbidden' });
  });

  it('plans a validated batch for the authenticated maintainer', async () => {
    const dependenciesValue = dependencies();
    const response = await app(dependenciesValue).request(
      '/api/v1/admin/catalog/imports/plan',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(planBody()),
      },
    );

    expect(response.status).toBe(200);
    expect(dependenciesValue.rateLimitMutation).toHaveBeenCalledWith(USER_ID);
    expect(dependenciesValue.planBatch).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ environment: 'staging' }),
    );
  });

  it('rejects client attempts to target another environment', async () => {
    const dependenciesValue = dependencies();
    const response = await app(dependenciesValue).request(
      '/api/v1/admin/catalog/imports/plan',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(planBody('production')),
      },
    );

    expect(response.status).toBe(409);
    expect(dependenciesValue.planBatch).not.toHaveBeenCalled();
  });

  it('accepts a dedicated gzip upload for the maintainer', async () => {
    const dependenciesValue = dependencies();
    const form = new FormData();
    form.set(
      'catalog',
      new Blob([gzipSync('header\nvalue\n')]),
      'courses.csv.gz',
    );
    form.set('manifest', '{"schema_version":1}');
    const response = await app(dependenciesValue).request(
      '/api/v1/admin/catalog/imports/upload',
      {
        method: 'POST',
        headers: { authorization: 'Bearer token' },
        body: form,
      },
    );

    expect(response.status).toBe(200);
    expect(dependenciesValue.upload).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        filename: 'courses.csv.gz',
        manifestValue: { schema_version: 1 },
        csvBytes: new TextEncoder().encode('header\nvalue\n'),
      }),
    );
  });

  it('applies the complete import with the actual request ID', async () => {
    const dependenciesValue = dependencies();
    const response = await app(dependenciesValue).request(
      `/api/v1/admin/catalog/imports/${IMPORT_ID}/apply-all`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirm_deactivations: true }),
      },
    );

    expect(response.status).toBe(200);
    expect(dependenciesValue.applyAll).toHaveBeenCalledWith(
      USER_ID,
      IMPORT_ID,
      REQUEST_ID,
      { confirm_deactivations: true },
    );
  });

  it('rejects full apply from a non-maintainer', async () => {
    const dependenciesValue = dependencies(false);
    const response = await app(dependenciesValue).request(
      `/api/v1/admin/catalog/imports/${IMPORT_ID}/apply-all`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirm_deactivations: true }),
      },
    );

    expect(response.status).toBe(403);
    expect(dependenciesValue.applyAll).not.toHaveBeenCalled();
  });

  it('cancels a plan with an audited reason and request ID', async () => {
    const dependenciesValue = dependencies();
    const response = await app(dependenciesValue).request(
      `/api/v1/admin/catalog/imports/${IMPORT_ID}/cancel`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Superseded upload' }),
      },
    );

    expect(response.status).toBe(200);
    expect(dependenciesValue.cancel).toHaveBeenCalledWith(
      USER_ID,
      IMPORT_ID,
      REQUEST_ID,
      { reason: 'Superseded upload' },
    );
  });

  it('does not expose the obsolete partial apply route', async () => {
    const response = await app(dependencies()).request(
      `/api/v1/admin/catalog/imports/${IMPORT_ID}/apply`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          batch_index: 0,
          confirm_deactivations: true,
        }),
      },
    );

    expect(response.status).toBe(404);
  });

  it('returns status for a canonical import ID', async () => {
    const dependenciesValue = dependencies();
    const response = await app(dependenciesValue).request(
      `/api/v1/admin/catalog/imports/${IMPORT_ID}`,
      { headers: { authorization: 'Bearer token' } },
    );

    expect(response.status).toBe(200);
    expect(dependenciesValue.rateLimitRead).toHaveBeenCalledWith(USER_ID);
    expect(dependenciesValue.getStatus).toHaveBeenCalledWith(IMPORT_ID);
  });
});
