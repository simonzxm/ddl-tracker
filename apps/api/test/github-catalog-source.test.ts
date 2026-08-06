import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { GithubCatalogSource } from '../src/catalog/github-catalog-source.js';

const COMMIT = 'c0c3db8d883385e9f9868ac04cc72ef64482f52d';
const VERSION_A = 'a'.repeat(64);
const VERSION_B = 'b'.repeat(64);
const VERSION_C = 'c'.repeat(64);
const VERSION_D = 'd'.repeat(64);

function directory(...terms: string[]): Response {
  const links = terms
    .map(
      (term) =>
        `<a href="/at-nju/courses/tree/main/data/${term}">${term}</a>`,
    )
    .join('');
  return new Response(`{"currentOid":"${COMMIT}"}${links}`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function metadata(version: string, bytes: number): Response {
  return new Response(null, {
    status: 200,
    headers: {
      etag: `"${version}"`,
      'content-length': String(bytes),
    },
  });
}

describe('GithubCatalogSource', () => {
  it('preserves the global fetch receiver when no fetcher is injected', async () => {
    const globalFetcher = vi.fn(async function (
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      if (String(input) === 'https://github.com/at-nju/courses/tree/main/data') {
        return directory('2026-2027-1');
      }
      expect(init?.method).toBe('HEAD');
      return metadata(VERSION_A, 1200);
    });
    vi.stubGlobal('fetch', globalFetcher);
    try {
      const source = new GithubCatalogSource();

      await expect(source.list(new Map())).resolves.toMatchObject({
        repository: 'at-nju/courses',
        commitSha: COMMIT,
        catalogs: [
          expect.objectContaining({
            termCode: '2026-2027-1',
            sourceVersion: VERSION_A,
          }),
        ],
      });
      expect(globalFetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('discovers recent and unsynced datasets from one pinned commit', async () => {
    const versions = new Map([
      ['2026-2027-1', VERSION_A],
      ['2025-2026-3', VERSION_B],
      ['2025-2026-2', VERSION_C],
      ['2025-2026-1', VERSION_D],
    ]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://github.com/at-nju/courses/tree/main/data') {
        return directory(
          '2024-2025-3',
          '2025-2026-1',
          '2025-2026-2',
          '2025-2026-3',
          '2026-2027-1',
        );
      }
      expect(init?.method).toBe('HEAD');
      const term = /data\/(\d{4}-\d{4}-[123])\/courses\.csv\.gz$/u.exec(url)?.[1];
      if (term === undefined) throw new Error(`Unexpected URL: ${url}`);
      const version = versions.get(term);
      if (version === undefined) throw new Error(`Unexpected URL: ${url}`);
      expect(url).toContain(`/${COMMIT}/`);
      return metadata(version, 1000 + term.length);
    });
    const source = new GithubCatalogSource({
      fetcher,
      recentCatalogsToProbe: 10,
      bootstrapCatalogsToProbe: 10,
    });

    await expect(
      source.list(new Map([['2026-2027-1', VERSION_A]])),
    ).resolves.toEqual({
      repository: 'at-nju/courses',
      commitSha: COMMIT,
      catalogs: [
        {
          termCode: '2025-2026-1',
          path: 'data/2025-2026-1/courses.csv.gz',
          sourceVersion: VERSION_D,
          compressedBytes: 1011,
        },
        {
          termCode: '2025-2026-2',
          path: 'data/2025-2026-2/courses.csv.gz',
          sourceVersion: VERSION_C,
          compressedBytes: 1011,
        },
        {
          termCode: '2025-2026-3',
          path: 'data/2025-2026-3/courses.csv.gz',
          sourceVersion: VERSION_B,
          compressedBytes: 1011,
        },
        {
          termCode: '2026-2027-1',
          path: 'data/2026-2027-1/courses.csv.gz',
          sourceVersion: VERSION_A,
          compressedBytes: 1011,
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('downloads and expands a dataset through the pinned raw URL', async () => {
    const csv = new TextEncoder().encode('XNXQDM\n2026-2027-1\n');
    const gzip = gzipSync(csv);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        `https://raw.githubusercontent.com/at-nju/courses/${COMMIT}/data/2026-2027-1/courses.csv.gz`,
      );
      return new Response(gzip, {
        status: 200,
        headers: {
          etag: `"${VERSION_A}"`,
          'content-length': String(gzip.byteLength),
        },
      });
    });
    const source = new GithubCatalogSource({ fetcher });

    const result = await source.download(
      {
        termCode: '2026-2027-1',
        path: 'data/2026-2027-1/courses.csv.gz',
        sourceVersion: VERSION_A,
        compressedBytes: gzip.byteLength,
      },
      COMMIT,
    );

    expect(result).toEqual(csv);
  });

  it('rejects invalid directory and raw metadata responses', async () => {
    const missingCommit = new GithubCatalogSource({
      fetcher: vi.fn(async () => directory('2026-2027-1')),
    });
    const missingCommitResponse = directory('2026-2027-1');
    const missingCommitHtml = await missingCommitResponse.text();
    const invalidDirectory = new GithubCatalogSource({
      fetcher: vi.fn(async () =>
        new Response(missingCommitHtml.replace(COMMIT, 'invalid'), { status: 200 }),
      ),
    });
    await expect(invalidDirectory.list(new Map())).rejects.toThrow('commit SHA');

    const invalidMetadata = new GithubCatalogSource({
      fetcher: vi.fn(async (input: RequestInfo | URL) =>
        String(input).startsWith('https://github.com/')
          ? directory('2026-2027-1')
          : new Response(null, {
              status: 200,
              headers: { 'content-length': '100' },
            }),
      ),
    });
    await expect(invalidMetadata.list(new Map())).rejects.toThrow('metadata');

    await expect(missingCommit.list(new Map())).rejects.toThrow('metadata');
  });

  it('rejects invalid gzip data, version mismatches, and oversized datasets', async () => {
    const invalid = new GithubCatalogSource({
      fetcher: vi.fn(async () =>
        new Response('not gzip', {
          status: 200,
          headers: { etag: `"${VERSION_A}"`, 'content-length': '8' },
        }),
      ),
    });
    await expect(
      invalid.download(
        {
          termCode: '2026-2027-1',
          path: 'data/2026-2027-1/courses.csv.gz',
          sourceVersion: VERSION_A,
          compressedBytes: 8,
        },
        COMMIT,
      ),
    ).rejects.toThrow('gzip');

    const mismatch = new GithubCatalogSource({
      fetcher: vi.fn(async () =>
        new Response(gzipSync('data'), {
          status: 200,
          headers: { etag: `"${VERSION_B}"` },
        }),
      ),
    });
    await expect(
      mismatch.download(
        {
          termCode: '2026-2027-1',
          path: 'data/2026-2027-1/courses.csv.gz',
          sourceVersion: VERSION_A,
          compressedBytes: gzipSync('data').byteLength,
        },
        COMMIT,
      ),
    ).rejects.toThrow('version');

    const oversized = new GithubCatalogSource({
      fetcher: vi.fn(async () => new Response(new Uint8Array(20), { status: 200 })),
      maximumCompressedBytes: 10,
    });
    await expect(
      oversized.download(
        {
          termCode: '2026-2027-1',
          path: 'data/2026-2027-1/courses.csv.gz',
          sourceVersion: VERSION_A,
          compressedBytes: 20,
        },
        COMMIT,
      ),
    ).rejects.toThrow('compressed size limit');
  });
});
