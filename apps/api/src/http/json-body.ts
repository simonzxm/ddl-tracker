import type { z } from 'zod';

import { HttpError } from './errors.js';

function payloadTooLarge(maxBytes: number): HttpError {
  return new HttpError({
    code: 'payload_too_large',
    message: 'Request body exceeds the configured limit.',
    status: 413,
    details: { max_bytes: maxBytes },
  });
}

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

function assertDeclaredLength(request: Request, maxBytes: number): void {
  const value = request.headers.get('content-length');
  if (value === null || !/^\d+$/u.test(value)) {
    return;
  }

  const length = Number(value);
  if (Number.isSafeInteger(length) && length > maxBytes) {
    throw payloadTooLarge(maxBytes);
  }
}

async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (request.body === null) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    let result = await reader.read();
    while (!result.done) {
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw payloadTooLarge(maxBytes);
      }
      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readValidatedJson<Output>(
  request: Request,
  schema: z.ZodType<Output>,
  maxBytes: number,
): Promise<Output> {
  assertJsonContentType(request);
  assertDeclaredLength(request, maxBytes);

  const bytes = await readBoundedBytes(request, maxBytes);
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
