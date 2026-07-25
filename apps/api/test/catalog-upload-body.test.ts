import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  CATALOG_UPLOAD_LIMITS,
  readCatalogUpload,
} from '../src/http/catalog-upload-body.js';

function uploadRequest(options: {
  catalog?: Blob;
  filename?: string;
  manifest?: string;
  extra?: boolean;
} = {}): Request {
  const form = new FormData();
  form.set(
    'catalog',
    options.catalog ?? new Blob([gzipSync('KCH\n001\n')]),
    options.filename ?? 'courses.csv.gz',
  );
  form.set('manifest', options.manifest ?? '{"schema_version":1}');
  if (options.extra === true) {
    form.set('environment', 'production');
  }
  return new Request('https://example.test/upload', {
    method: 'POST',
    body: form,
  });
}

describe('readCatalogUpload', () => {
  it('reads one gzip catalog and one JSON manifest', async () => {
    await expect(readCatalogUpload(uploadRequest())).resolves.toMatchObject({
      filename: 'courses.csv.gz',
      manifestValue: { schema_version: 1 },
      csvBytes: new TextEncoder().encode('KCH\n001\n'),
    });
  });

  it('requires multipart content and only the documented fields', async () => {
    await expect(
      readCatalogUpload(
        new Request('https://example.test/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/gzip' },
          body: gzipSync('csv'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported_media_type', status: 415 });
    await expect(readCatalogUpload(uploadRequest({ extra: true }))).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
    });
  });

  it('requires a .csv.gz file with actual gzip data', async () => {
    await expect(
      readCatalogUpload(uploadRequest({ filename: 'courses.csv' })),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      readCatalogUpload(uploadRequest({ catalog: new Blob(['not gzip']) })),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('bounds compressed, manifest, and decompressed sizes', async () => {
    const tinyLimits = {
      ...CATALOG_UPLOAD_LIMITS,
      gzipBytes: 4,
      manifestBytes: 4,
      csvBytes: 4,
    };
    await expect(
      readCatalogUpload(uploadRequest(), { ...tinyLimits, gzipBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'payload_too_large', status: 413 });
    await expect(
      readCatalogUpload(uploadRequest(), { ...tinyLimits, manifestBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'payload_too_large', status: 413 });
    await expect(
      readCatalogUpload(uploadRequest(), {
        ...tinyLimits,
        gzipBytes: 1024,
        manifestBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: 'payload_too_large', status: 413 });
  });
});
