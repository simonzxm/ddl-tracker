import { normalizePlainText } from '@ddl-tracker/contracts';

import { assertDeclaredLength, readBoundedBytes } from './bounded-body.js';
import { HttpError } from './errors.js';

export interface CatalogUploadLimits {
  multipartBytes: number;
  gzipBytes: number;
  manifestBytes: number;
  csvBytes: number;
}

export const CATALOG_UPLOAD_LIMITS: CatalogUploadLimits = {
  multipartBytes: 5 * 1024 * 1024,
  gzipBytes: 4 * 1024 * 1024,
  manifestBytes: 16 * 1024,
  csvBytes: 10 * 1024 * 1024,
} as const;

export interface CatalogUploadBody {
  filename: string;
  csvBytes: Uint8Array;
  manifestValue: unknown;
}

function invalidUpload(message: string): HttpError {
  return new HttpError({
    code: 'invalid_request',
    message,
    status: 400,
  });
}

function assertMultipart(request: Request): string {
  const contentType = request.headers.get('content-type');
  if (
    contentType === null ||
    !/^multipart\/form-data\s*;.*\bboundary=/iu.test(contentType)
  ) {
    throw new HttpError({
      code: 'unsupported_media_type',
      message: 'Content-Type must be multipart/form-data with a boundary.',
      status: 415,
    });
  }
  return contentType;
}

function singlePart(form: FormData, name: string): FormDataEntryValue {
  const values = form.getAll(name);
  if (values.length !== 1) {
    throw invalidUpload(`Multipart field ${name} must appear exactly once.`);
  }
  const value = values[0];
  if (value === undefined) {
    throw invalidUpload(`Multipart field ${name} is missing.`);
  }
  return value;
}

async function partBytes(
  value: FormDataEntryValue,
  maxBytes: number,
): Promise<Uint8Array> {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : new Uint8Array(await value.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new HttpError({
      code: 'payload_too_large',
      message: 'Multipart field exceeds the configured limit.',
      status: 413,
      details: { max_bytes: maxBytes },
    });
  }
  return bytes;
}

async function decompressGzip(
  gzipBytes: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  if (gzipBytes[0] !== 0x1f || gzipBytes[1] !== 0x8b) {
    throw invalidUpload('Catalog file must contain gzip data.');
  }
  try {
    const decompressed = new Blob([Uint8Array.from(gzipBytes).buffer])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return await readBoundedBytes(decompressed, maxBytes);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw invalidUpload('Catalog gzip data is invalid or truncated.');
  }
}

export async function readCatalogUpload(
  request: Request,
  limits: CatalogUploadLimits = CATALOG_UPLOAD_LIMITS,
): Promise<CatalogUploadBody> {
  const contentType = assertMultipart(request);
  assertDeclaredLength(request, limits.multipartBytes);
  const body = await readBoundedBytes(request.body, limits.multipartBytes);

  let form: FormData;
  try {
    form = await new Request('https://upload.invalid/', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: Uint8Array.from(body).buffer,
    }).formData();
  } catch {
    throw invalidUpload('Multipart request body is malformed.');
  }

  for (const name of form.keys()) {
    if (name !== 'catalog' && name !== 'manifest') {
      throw invalidUpload(`Unexpected multipart field: ${name}.`);
    }
  }

  const catalog = singlePart(form, 'catalog');
  if (typeof catalog === 'string') {
    throw invalidUpload('Multipart field catalog must be a file.');
  }
  const filename = normalizePlainText(catalog.name);
  if (
    filename.length === 0 ||
    Array.from(filename).length > 255 ||
    !/\.csv\.gz$/iu.test(filename)
  ) {
    throw invalidUpload('Catalog filename must end in .csv.gz and be at most 255 characters.');
  }

  const manifestBytes = await partBytes(
    singlePart(form, 'manifest'),
    limits.manifestBytes,
  );
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
    );
  } catch {
    throw invalidUpload('Manifest must contain valid UTF-8 JSON.');
  }

  const gzipBytes = await partBytes(catalog, limits.gzipBytes);
  const csvBytes = await decompressGzip(gzipBytes, limits.csvBytes);
  return { filename, csvBytes, manifestValue };
}
