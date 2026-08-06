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
          externalCode: '2026-2027-1',
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
          externalCode: '2026-2027-1',
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
          externalCode: '2025-2026-2',
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
          externalCode: '2027-2028-1',
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
          externalCode: '2025-2026-1',
          startsOn: null,
          endsOn: null,
          statusOverride: 'archived',
        },
        NOW,
      ),
    ).toBe('archived');
  });

  it('falls back to the upstream term code when calendar dates are unavailable', () => {
    const now = new Date('2026-08-06T08:00:00.000Z');
    const base = {
      startsOn: null,
      endsOn: null,
      statusOverride: null,
    } as const;

    expect(
      deriveTermStatus({ ...base, externalCode: '2025-2026-2' }, now),
    ).toBe('archived');
    expect(
      deriveTermStatus({ ...base, externalCode: '2025-2026-3' }, now),
    ).toBe('in_progress');
    expect(
      deriveTermStatus({ ...base, externalCode: '2026-2027-1' }, now),
    ).toBe('upcoming');
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

  it('maps section department fields to the public contract', async () => {
    const service = new CatalogService({
      repository: {
        ...repository,
        listClassSections: () =>
          Promise.resolve([
            {
              id: '018f0000-0000-7000-8000-000000000002',
              externalSectionId: 'section-1',
              sectionNumber: '01',
              departmentCode: '001',
              departmentName: 'Department',
              instructors: [],
              campus: null,
              capacity: null,
              scheduleText: null,
              active: true,
              revision: 1,
            },
          ]),
      },
    });

    await expect(service.listClassSections('course-1')).resolves.toEqual([
      expect.objectContaining({
        department_code: '001',
        department_name: 'Department',
      }),
    ]);
  });
});
