import { describe, expect, it } from 'vitest';

import {
  CatalogService,
  deriveTermStatus,
  type CatalogRepository,
} from '../src/catalog/catalog-service.js';

const NOW = new Date('2026-08-30T16:00:00.000Z');

const repository: CatalogRepository = {
  listTerms: () =>
    Promise.resolve([
      {
        id: '018f0000-0000-7000-8000-000000000001',
        externalCode: '2026-2027-1',
        name: 'Term',
        startsOn: '2026-08-31',
        endsOn: '2027-01-17',
        statusOverride: null,
      },
    ]),
  listCourses: () => Promise.resolve([]),
  listClassSections: () => Promise.resolve([]),
};

describe('deriveTermStatus', () => {
  it('uses Asia/Shanghai local dates at the UTC boundary', () => {
    expect(
      deriveTermStatus(
        {
          startsOn: '2026-08-31',
          endsOn: '2027-01-17',
          statusOverride: null,
        },
        NOW,
      ),
    ).toBe('in_progress');
  });

  it('returns upcoming before the local start day', () => {
    expect(
      deriveTermStatus(
        {
          startsOn: '2026-09-01',
          endsOn: '2027-01-17',
          statusOverride: null,
        },
        NOW,
      ),
    ).toBe('upcoming');
  });

  it('archives after the local end day and honors overrides', () => {
    expect(
      deriveTermStatus(
        {
          startsOn: '2026-01-01',
          endsOn: '2026-08-30',
          statusOverride: null,
        },
        NOW,
      ),
    ).toBe('archived');
    expect(
      deriveTermStatus(
        {
          startsOn: '2027-01-01',
          endsOn: '2027-06-01',
          statusOverride: 'active',
        },
        NOW,
      ),
    ).toBe('in_progress');
    expect(
      deriveTermStatus(
        {
          startsOn: null,
          endsOn: null,
          statusOverride: 'archived',
        },
        NOW,
      ),
    ).toBe('archived');
  });
});

describe('CatalogService', () => {
  it('maps repository records to public snake case terms', async () => {
    const service = new CatalogService({ repository, now: () => NOW });

    await expect(service.listTerms()).resolves.toEqual([
      {
        id: '018f0000-0000-7000-8000-000000000001',
        external_code: '2026-2027-1',
        name: 'Term',
        starts_on: '2026-08-31',
        ends_on: '2027-01-17',
        status: 'in_progress',
      },
    ]);
  });
});
