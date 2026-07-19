import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from '../src/error.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000000000';

describe('API error envelope', () => {
  it('accepts stable structured errors', () => {
    expect(
      apiErrorSchema.parse({
        code: 'rate_limited',
        details: { scope: 'request' },
        message: 'Try again later.',
        retryable: true,
        retry_after: 60,
        request_id: REQUEST_ID,
      }),
    ).toEqual({
      code: 'rate_limited',
      details: { scope: 'request' },
      message: 'Try again later.',
      retryable: true,
      retry_after: 60,
      request_id: REQUEST_ID,
    });
  });

  it('rejects unknown codes, invalid request IDs, and extra fields', () => {
    expect(() =>
      apiErrorSchema.parse({
        code: 'made_up',
        details: {},
        message: 'No.',
        retryable: false,
        request_id: REQUEST_ID,
      }),
    ).toThrow();
    expect(() =>
      apiErrorSchema.parse({
        code: 'unauthenticated',
        details: {},
        message: 'No.',
        retryable: false,
        request_id: 'bad',
      }),
    ).toThrow();
    expect(() =>
      apiErrorSchema.parse({
        code: 'unauthenticated',
        details: {},
        message: 'No.',
        retryable: false,
        request_id: REQUEST_ID,
        stack: 'secret',
      }),
    ).toThrow();
  });
});
