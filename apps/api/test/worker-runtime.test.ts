import { describe, expect, it } from 'vitest';

import { createApp } from '../src/http/app.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000004501';

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
});
