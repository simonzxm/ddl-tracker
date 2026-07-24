import { describe, expect, it, vi } from 'vitest';

import { AdminApiClient, AdminApiError } from '../src/api-client.js';

const IMPORT_ID = '018f0000-0000-7000-8000-000000001001';
const HASH = 'a'.repeat(64);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AdminApiClient', () => {
  it('sends one request for an atomic full apply', async () => {
    const fetcher = vi.fn(async () =>
      response({
        import_id: IMPORT_ID,
        batch_index: 30,
        replayed: false,
        applied_batches: 31,
        total_batches: 31,
        complete: true,
      }),
    );
    const client = new AdminApiClient({
      baseUrl: 'https://api.example.test',
      token: 'token',
      fetcher,
    });

    await expect(
      client.applyAll(IMPORT_ID, { confirm_deactivations: true }),
    ).resolves.toMatchObject({ complete: true, applied_batches: 31 });
    const call = fetcher.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    expect(call?.[0]).toBe(
      `https://api.example.test/api/v1/admin/catalog/imports/${IMPORT_ID}/apply-all`,
    );
    expect(JSON.parse(String(call?.[1].body))).toEqual({
      confirm_deactivations: true,
    });
  });

  it('sends bearer-authenticated plan requests and validates responses', async () => {
    const fetcher = vi.fn(async () =>
      response({
        import_id: IMPORT_ID,
        batch_index: 0,
        accepted: true,
        received_batches: 1,
        total_batches: 1,
        plan_complete: false,
        diff: null,
      }),
    );
    const client = new AdminApiClient({
      baseUrl: 'https://api.example.test/',
      token: 'secret-token',
      fetcher,
    });

    const result = await client.planBatch({
      import_id: null,
      filename: 'fixture.csv',
      checksum: HASH,
      header_hash: HASH,
      manifest_hash: HASH,
      environment: 'staging',
      manifest: {},
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
    });

    expect(result.import_id).toBe(IMPORT_ID);
    expect(fetcher).toHaveBeenCalledOnce();
    const call = fetcher.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    if (call === undefined) {
      throw new Error('Expected one fetch call.');
    }
    const [url, init] = call;
    expect(url).toBe('https://api.example.test/api/v1/admin/catalog/imports/plan');
    expect(init).toMatchObject({ method: 'POST' });
    expect(new Headers(init.headers).get('authorization')).toBe(
      'Bearer secret-token',
    );
  });

  it('applies batches and reads import status', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          import_id: IMPORT_ID,
          batch_index: 0,
          replayed: false,
          applied_batches: 1,
          total_batches: 1,
          complete: true,
        }),
      )
      .mockResolvedValueOnce(
        response({
          import_id: IMPORT_ID,
          status: 'applied',
          received_batches: 1,
          applied_batches: 1,
          total_batches: 1,
          diff: null,
          failure_message: null,
        }),
      );
    const client = new AdminApiClient({
      baseUrl: 'https://api.example.test',
      token: 'token',
      fetcher,
    });

    await expect(
      client.applyBatch(IMPORT_ID, {
        batch_index: 0,
        confirm_deactivations: true,
      }),
    ).resolves.toMatchObject({ complete: true });
    await expect(client.getStatus(IMPORT_ID)).resolves.toMatchObject({
      status: 'applied',
    });
  });

  it('maps structured API failures without including the token', async () => {
    const fetcher = vi.fn(async () =>
      response(
        {
          code: 'revision_conflict',
          details: { current_revision: 2 },
          message: 'Catalog changed.',
          retryable: false,
          request_id: IMPORT_ID,
        },
        409,
      ),
    );
    const client = new AdminApiClient({
      baseUrl: 'https://api.example.test',
      token: 'secret-token',
      fetcher,
    });

    const error = await client.getStatus(IMPORT_ID).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({
      code: 'revision_conflict',
      status: 409,
      requestId: IMPORT_ID,
    });
    expect(String(error)).not.toContain('secret-token');
  });

  it('rejects malformed successful responses', async () => {
    const client = new AdminApiClient({
      baseUrl: 'https://api.example.test',
      token: 'token',
      fetcher: vi.fn(async () => response({ unexpected: true })),
    });

    await expect(client.getStatus(IMPORT_ID)).rejects.toThrow(
      'API response failed validation',
    );
  });
});
