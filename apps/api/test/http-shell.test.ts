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

  it('maps failed readiness to a generic unavailable error', async () => {
    const app = createApp({
      createRequestId: () => REQUEST_ID,
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
