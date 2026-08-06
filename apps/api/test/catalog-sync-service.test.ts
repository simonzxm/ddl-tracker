import { describe, expect, it, vi } from 'vitest';

import {
  CatalogSyncService,
  type CatalogSyncRepository,
} from '../src/catalog/catalog-sync-service.js';
import type {
  CatalogSource,
  CatalogSourceDescriptor,
} from '../src/catalog/github-catalog-source.js';

const COMMIT = 'c0c3db8d883385e9f9868ac04cc72ef64482f52d';
const CURRENT: CatalogSourceDescriptor = {
  termCode: '2025-2026-3',
  path: 'data/2025-2026-3/courses.csv.gz',
  blobSha: 'a'.repeat(40),
  compressedBytes: 100,
};
const CHANGED: CatalogSourceDescriptor = {
  termCode: '2026-2027-1',
  path: 'data/2026-2027-1/courses.csv.gz',
  blobSha: 'b'.repeat(40),
  compressedBytes: 200,
};

function csv(termCode = CHANGED.termCode): Uint8Array {
  const headers = [
    'XNXQDM',
    'XNXQDM_DISPLAY',
    'KCH',
    'KCM',
    'XF',
    'PKDWDM',
    'PKDWDM_DISPLAY',
    'JXBID',
    'JXBMC',
    'KXH',
    'SKJS',
    'XXXQDM',
    'XXXQDM_DISPLAY',
    'XKZRS',
    'YPSJDD',
    'SKZC',
    'SKXQ',
    'SKJC',
    'SKJAS',
    'JXLDM',
    'JXLDM_DISPLAY',
  ];
  const values = [
    termCode,
    '2026-2027学年 第1学期',
    '0010',
    'Course',
    '3',
    '001',
    'Department',
    'section-1',
    'Section',
    '01',
    '',
    '01',
    'Campus',
    '30',
    'Thursday 9-11',
    '1-18',
    '4',
    '9-11',
    'Room',
    'B01',
    'Building',
  ];
  return new TextEncoder().encode(`${headers.join(',')}\n${values.join(',')}\n`);
}

function repository(): CatalogSyncRepository & {
  currentBlobShas: ReturnType<typeof vi.fn>;
  apply: ReturnType<typeof vi.fn>;
  recordFailure: ReturnType<typeof vi.fn>;
} {
  return {
    currentBlobShas: vi.fn(async () => new Map([[CURRENT.termCode, CURRENT.blobSha]])),
    apply: vi.fn(async () => ({ changed: true })),
    recordFailure: vi.fn(async () => undefined),
  };
}

describe('CatalogSyncService', () => {
  it('downloads and atomically applies only changed term blobs', async () => {
    const source: CatalogSource = {
      list: vi.fn(async () => ({
        repository: 'at-nju/courses',
        commitSha: COMMIT,
        catalogs: [CURRENT, CHANGED],
      })),
      download: vi.fn(async (catalog) => {
        expect(catalog).toEqual(CHANGED);
        return csv();
      }),
    };
    const repo = repository();
    const service = new CatalogSyncService({
      source,
      repository: repo,
      createId: () => '018f0000-0000-7000-8000-000000000001',
      now: () => new Date('2026-08-06T08:00:00.000Z'),
    });

    await expect(service.sync()).resolves.toEqual({
      repository: 'at-nju/courses',
      commit_sha: COMMIT,
      discovered: 2,
      unchanged: 1,
      synced: 1,
      terms: ['2026-2027-1'],
    });
    expect(source.download).toHaveBeenCalledTimes(1);
    expect(repo.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: '018f0000-0000-7000-8000-000000000001',
        repository: 'at-nju/courses',
        commitSha: COMMIT,
        source: CHANGED,
        catalog: expect.objectContaining({
          term: expect.objectContaining({ external_code: CHANGED.termCode }),
          courses: [expect.objectContaining({ external_course_code: '0010' })],
        }),
      }),
    );
    expect(repo.recordFailure).not.toHaveBeenCalled();
  });

  it('records a failed source version without applying partial catalog data', async () => {
    const source: CatalogSource = {
      list: vi.fn(async () => ({
        repository: 'at-nju/courses',
        commitSha: COMMIT,
        catalogs: [CHANGED],
      })),
      download: vi.fn(async () => csv('wrong-term')),
    };
    const repo = repository();
    repo.currentBlobShas.mockResolvedValue(new Map());
    const service = new CatalogSyncService({
      source,
      repository: repo,
      createId: () => '018f0000-0000-7000-8000-000000000002',
      now: () => new Date('2026-08-06T08:00:00.000Z'),
    });

    await expect(service.sync()).rejects.toThrow('expected term');
    expect(repo.apply).not.toHaveBeenCalled();
    expect(repo.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: '018f0000-0000-7000-8000-000000000002',
        source: CHANGED,
        errorMessage: expect.stringContaining('expected term'),
      }),
    );
  });
});
