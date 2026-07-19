import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { readValidatedJson } from '../src/http/json-body.js';

const schema = z.object({ value: z.string() }).strict();

function request(body: string, headers?: HeadersInit): Request {
  return new Request('https://example.test/v1/test', {
    method: 'POST',
    ...(headers === undefined ? {} : { headers }),
    body,
  });
}

describe('readValidatedJson', () => {
  it('accepts application/json with charset', async () => {
    const result = await readValidatedJson(
      request('{"value":"ok"}', {
        'content-type': 'application/json; charset=utf-8',
      }),
      schema,
      100,
    );

    expect(result).toEqual({ value: 'ok' });
  });

  it('rejects unsupported content types', async () => {
    await expect(
      readValidatedJson(
        request('{"value":"ok"}', { 'content-type': 'text/plain' }),
        schema,
        100,
      ),
    ).rejects.toMatchObject({
      code: 'unsupported_media_type',
      status: 415,
    });
  });

  it('rejects declared bodies over the configured limit', async () => {
    await expect(
      readValidatedJson(
        request('{"value":"ok"}', {
          'content-type': 'application/json',
          'content-length': '999',
        }),
        schema,
        100,
      ),
    ).rejects.toMatchObject({ code: 'payload_too_large', status: 413 });
  });

  it('enforces the actual streamed byte limit without trusting headers', async () => {
    await expect(
      readValidatedJson(
        request(JSON.stringify({ value: 'x'.repeat(200) }), {
          'content-type': 'application/json',
          'content-length': '10',
        }),
        schema,
        100,
      ),
    ).rejects.toMatchObject({ code: 'payload_too_large', status: 413 });
  });

  it('maps malformed JSON and schema failures to invalid_request', async () => {
    await expect(
      readValidatedJson(
        request('{', { 'content-type': 'application/json' }),
        schema,
        100,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 400 });

    await expect(
      readValidatedJson(
        request('{"value":1}', { 'content-type': 'application/json' }),
        schema,
        100,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
  });
});
