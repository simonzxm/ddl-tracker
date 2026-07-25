import { describe, expect, it } from 'vitest';

import type { AuthenticatedPrincipal } from '../src/auth/account-service.js';
import { createApp } from '../src/http/app.js';
import type { AdminCatalogRouteDependencies } from '../src/http/admin-catalog-routes.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000004501';
const USER_ID = '018f0000-0000-7000-8000-000000004502';
const IMPORT_ID = '018f0000-0000-7000-8000-000000004503';
const HASH = 'a'.repeat(64);

function principal(hasMaintainerRole = true): AuthenticatedPrincipal {
  const now = new Date();
  return {
    user: {
      id: USER_ID,
      username: 'maintainer',
      displayName: 'Maintainer',
      status: 'active',
      profileRevision: 1,
    },
    session: {
      id: '018f0000-0000-7000-8000-000000004504',
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
    roles: hasMaintainerRole ? ['maintainer'] : [],
  };
}

async function gzip(value: string): Promise<ArrayBuffer> {
  return await new Response(
    new Blob([value])
      .stream()
      .pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
}

function adminCatalog(
  capture: (value: Uint8Array) => void,
  hasMaintainerRole = true,
): AdminCatalogRouteDependencies {
  const unsupported = (): never => {
    throw new Error('Unexpected catalog operation in Workers runtime test.');
  };
  return {
    environment: 'test',
    authenticate: async () => principal(hasMaintainerRole),
    rateLimitRead: async () => undefined,
    rateLimitMutation: async () => undefined,
    planBatch: unsupported,
    applyAll: unsupported,
    cancel: unsupported,
    getStatus: unsupported,
    upload: async (_actorId, _requestId, input) => {
      capture(input.csvBytes);
      return {
        import_id: IMPORT_ID,
        replayed: false,
        filename: input.filename,
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
      };
    },
  };
}

describe('Workers runtime API shell', () => {
  it('serves liveness, CORS, and OpenAPI with Workers Web Crypto', async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('ddl-tracker'),
    );
    expect(digest.byteLength).toBe(32);

    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: () => Promise.resolve(true),
    });

    const live = await app.request('/api/health/live');
    expect(live.status).toBe(200);
    expect(live.headers.get('x-request-id')).toBe(REQUEST_ID);

    const preflight = await app.request('/api/v1/sync', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://client.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.has('access-control-allow-credentials')).toBe(
      false,
    );

    const openapi = await app.request('/api/openapi.json');
    expect(openapi.status).toBe(200);
    await expect(openapi.json()).resolves.toMatchObject({ openapi: '3.1.0' });
  });

  it('parses bounded multipart gzip uploads in the Workers runtime', async () => {
    let csvBytes: Uint8Array | null = null;
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: () => Promise.resolve(true),
      adminCatalog: adminCatalog((value) => {
        csvBytes = value;
      }),
    });
    const form = new FormData();
    form.set(
      'catalog',
      new Blob([await gzip('header\nvalue\n')], { type: 'application/gzip' }),
      'courses.csv.gz',
    );
    form.set('manifest', '{"schema_version":1}');

    const response = await app.request('/api/v1/admin/catalog/imports/upload', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: form,
    });

    expect(response.status).toBe(200);
    expect(csvBytes).toEqual(new TextEncoder().encode('header\nvalue\n'));
  });

  it('rejects oversized uploads before parsing multipart data', async () => {
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: () => Promise.resolve(true),
      adminCatalog: adminCatalog(() => undefined),
    });
    const response = await app.request('/api/v1/admin/catalog/imports/upload', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'multipart/form-data; boundary=test',
        'content-length': String(6 * 1024 * 1024),
      },
      body: '--test--\r\n',
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: 'payload_too_large',
      request_id: REQUEST_ID,
    });
  });

  it('requires bearer authentication before reading an upload body', async () => {
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: () => Promise.resolve(true),
      adminCatalog: adminCatalog(() => undefined),
    });
    const response = await app.request('/api/v1/admin/catalog/imports/upload', {
      method: 'POST',
      body: 'not multipart',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('forbids upload and cancellation without the maintainer role', async () => {
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: () => Promise.resolve(true),
      adminCatalog: adminCatalog(() => undefined, false),
    });

    for (const path of [
      '/api/v1/admin/catalog/imports/upload',
      `/api/v1/admin/catalog/imports/${IMPORT_ID}/cancel`,
    ]) {
      const response = await app.request(path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: 'forbidden',
      });
    }
  });
});
