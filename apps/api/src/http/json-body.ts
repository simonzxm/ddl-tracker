import type { z } from 'zod';

import { assertDeclaredLength, readBoundedBytes } from './bounded-body.js';
import { HttpError } from './errors.js';

function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get('content-type');
  if (
    contentType === null ||
    !/^application\/json(?:\s*;.*)?$/iu.test(contentType)
  ) {
    throw new HttpError({
      code: 'unsupported_media_type',
      message: 'Content-Type must be application/json.',
      status: 415,
    });
  }
}

export async function readValidatedJson<Output>(
  request: Request,
  schema: z.ZodType<Output>,
  maxBytes: number,
): Promise<Output> {
  assertJsonContentType(request);
  assertDeclaredLength(request, maxBytes);

  const bytes = await readBoundedBytes(request.body, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError({
      code: 'invalid_request',
      message: 'Request body must contain valid UTF-8 JSON.',
      status: 400,
    });
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError({
      code: 'invalid_request',
      message: 'Request body failed validation.',
      status: 400,
      details: {
        issues: result.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.map(String),
          message: issue.message,
        })),
      },
    });
  }

  return result.data;
}
