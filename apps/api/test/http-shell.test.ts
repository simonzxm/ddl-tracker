import { describe, expect, it } from 'vitest';

import { createApp } from '../src/http/app.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000000001';

describe('HTTP shell', () => {
  it('serves liveness without touching dependencies', async () => {
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: async () => {
        throw new Error('must not run');
      },
    });

    const response = await app.request('/health/live');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe(REQUEST_ID);
    await expect(response.json()).resolves.toEqual({ status: 'live' });
  });

  it('serves non-credentialed CORS preflight for bearer clients', async () => {
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: async () => true,
    });

    const response = await app.request('/v1/sync', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://client.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'POST',
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'Authorization',
    );
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
    expect(response.headers.get('x-request-id')).toBe(REQUEST_ID);
  });

  it('logs only normalized request metadata', async () => {
    const entries: unknown[] = [];
    const times = [10, 17];
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      nowMilliseconds: () => times.shift() ?? 17,
      logRequest: (entry) => {
        entries.push(entry);
      },
      checkReady: async () => true,
    });

    const response = await app.request(
      '/health/ready?email=student@school.example',
      {
        headers: {
          authorization: 'Bearer secret-session-token',
          'x-private-note': 'private body text',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(entries).toEqual([
      {
        request_id: REQUEST_ID,
        method: 'GET',
        route: '/health/ready',
        status: 200,
        duration_ms: 7,
      },
    ]);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('secret-session-token');
    expect(serialized).not.toContain('student@school.example');
    expect(serialized).not.toContain('private body text');
  });

  it('maps and logs failed readiness as a generic unavailable error', async () => {
    const entries: unknown[] = [];
    const times = [20, 25];
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      nowMilliseconds: () => times.shift() ?? 25,
      logRequest: (entry) => {
        entries.push(entry);
      },
      checkReady: async () => false,
    });

    const response = await app.request('/health/ready');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'temporarily_unavailable',
      details: {},
      message: 'Service is not ready.',
      retryable: true,
      request_id: REQUEST_ID,
    });
    expect(entries).toEqual([
      {
        request_id: REQUEST_ID,
        method: 'GET',
        route: '/health/ready',
        status: 503,
        duration_ms: 5,
      },
    ]);
  });

  it('returns structured not found errors', async () => {
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: async () => true,
    });

    const response = await app.request('/missing');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'not_found',
      request_id: REQUEST_ID,
    });
  });

  it('does not expose unexpected exception details', async () => {
    const app = createApp({
      createRequestId: () => REQUEST_ID,
      checkReady: async () => {
        throw new Error('postgresql://secret-host/private');
      },
    });

    const response = await app.request('/health/ready');
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain('secret-host');
  });
});
