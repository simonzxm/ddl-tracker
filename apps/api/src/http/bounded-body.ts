import { HttpError } from './errors.js';

function payloadTooLarge(maxBytes: number): HttpError {
  return new HttpError({
    code: 'payload_too_large',
    message: 'Request body exceeds the configured limit.',
    status: 413,
    details: { max_bytes: maxBytes },
  });
}

export function assertDeclaredLength(
  request: Request,
  maxBytes: number,
): void {
  const value = request.headers.get('content-length');
  if (value === null || !/^\d+$/u.test(value)) {
    return;
  }

  const length = Number(value);
  if (Number.isSafeInteger(length) && length > maxBytes) {
    throw payloadTooLarge(maxBytes);
  }
}

export async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (body === null) {
    return new Uint8Array();
  }

  const reader = body.getReader();
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
