import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { GithubCatalogSource } from '../src/catalog/github-catalog-source.js';

const COMMIT = 'c0c3db8d883385e9f9868ac04cc72ef64482f52d';

function json(value: unknown): Response {
  return Response.json(value, { status: 200 });
}

describe('GithubCatalogSource', () => {
  it('preserves the global fetch receiver when no fetcher is injected', async () => {
    const globalFetcher = vi.fn(async function (
      this: typeof globalThis,
      input: RequestInfo | URL,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      const url = String(input);
      if (url.endsWith('/commits/main')) return json({ sha: COMMIT });
      if (url.includes('/git/trees/')) {
        return json({
          truncated: false,
          tree: [
            {
              path: 'data/2026-2027-1/courses.csv.gz',
              type: 'blob',
              sha: 'a'.repeat(40),
              size: 1200,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', globalFetcher);
    try {
      const source = new GithubCatalogSource();

      await expect(source.list()).resolves.toMatchObject({
        repository: 'at-nju/courses',
        commitSha: COMMIT,
      });
      expect(globalFetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lists deterministic gzip datasets from one pinned upstream commit', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/commits/main')) return json({ sha: COMMIT });
      if (url.includes('/git/trees/')) {
        return json({
          truncated: false,
          tree: [
            {
              path: 'data/2026-2027-1/courses.csv.gz',
              type: 'blob',
              sha: 'a'.repeat(40),
              size: 1200,
            },
            {
              path: 'data/2025-2026-3/courses.csv.gz',
              type: 'blob',
              sha: 'b'.repeat(40),
              size: 200,
            },
            {
              path: 'data/2026-2027-1/courses.csv',
              type: 'blob',
              sha: 'c'.repeat(40),
              size: 5000,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const source = new GithubCatalogSource({ fetcher });

    await expect(source.list()).resolves.toEqual({
      repository: 'at-nju/courses',
      commitSha: COMMIT,
      catalogs: [
        {
          termCode: '2025-2026-3',
          path: 'data/2025-2026-3/courses.csv.gz',
          blobSha: 'b'.repeat(40),
          compressedBytes: 200,
        },
        {
          termCode: '2026-2027-1',
          path: 'data/2026-2027-1/courses.csv.gz',
          blobSha: 'a'.repeat(40),
          compressedBytes: 1200,
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
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
        headers: { 'content-length': String(gzip.byteLength) },
      });
    });
    const source = new GithubCatalogSource({ fetcher });

    const result = await source.download(
      {
        termCode: '2026-2027-1',
        path: 'data/2026-2027-1/courses.csv.gz',
        blobSha: 'a'.repeat(40),
        compressedBytes: gzip.byteLength,
      },
      COMMIT,
    );

    expect(result).toEqual(csv);
  });

  it('rejects truncated trees, invalid gzip data, and oversized datasets', async () => {
    const truncated = new GithubCatalogSource({
      fetcher: vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/commits/main')
          ? json({ sha: COMMIT })
          : json({ truncated: true, tree: [] }),
      ),
    });
    await expect(truncated.list()).rejects.toThrow('truncated');

    const invalid = new GithubCatalogSource({
      fetcher: vi.fn(async () => new Response('not gzip', { status: 200 })),
    });
    await expect(
      invalid.download(
        {
          termCode: '2026-2027-1',
          path: 'data/2026-2027-1/courses.csv.gz',
          blobSha: 'a'.repeat(40),
          compressedBytes: 8,
        },
        COMMIT,
      ),
    ).rejects.toThrow('gzip');

    const oversized = new GithubCatalogSource({
      fetcher: vi.fn(async () => new Response(new Uint8Array(20), { status: 200 })),
      maximumCompressedBytes: 10,
    });
    await expect(
      oversized.download(
        {
          termCode: '2026-2027-1',
          path: 'data/2026-2027-1/courses.csv.gz',
          blobSha: 'a'.repeat(40),
          compressedBytes: 20,
        },
        COMMIT,
      ),
    ).rejects.toThrow('compressed size limit');
  });

  it('rejects a repository snapshot with no catalog datasets', async () => {
    const source = new GithubCatalogSource({
      fetcher: vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/commits/main')
          ? json({ sha: COMMIT })
          : json({
              truncated: false,
              tree: [
                {
                  path: 'README.md',
                  type: 'blob',
                  sha: 'a'.repeat(40),
                  size: 1,
                },
              ],
            }),
      ),
    });

    await expect(source.list()).rejects.toThrow('no catalog datasets');
  });
});
