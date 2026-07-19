import { describe, expect, it } from 'vitest';

import {
  hashCatalogManifest,
  parseCatalogManifest,
} from '../src/catalog/manifest.js';

const manifest = {
  schema_version: 1,
  source_system: 'course-management',
  term: {
    external_code: '2026-2027-1',
    display_name: '2026-2027学年 第1学期',
    starts_on: '2026-08-31',
    ends_on: '2027-01-17',
    time_zone: 'Asia/Shanghai',
  },
};

describe('catalog manifest', () => {
  it('parses the current schema and normalizes text', () => {
    expect(
      parseCatalogManifest({
        ...manifest,
        source_system: ' course-management ',
      }),
    ).toEqual(manifest);
  });

  it('rejects unknown versions, time zones, extra fields, and reversed dates', () => {
    for (const value of [
      { ...manifest, schema_version: 2 },
      { ...manifest, term: { ...manifest.term, time_zone: 'UTC' } },
      { ...manifest, unknown: true },
      {
        ...manifest,
        term: {
          ...manifest.term,
          starts_on: '2027-01-18',
          ends_on: '2027-01-17',
        },
      },
    ]) {
      expect(() => parseCatalogManifest(value)).toThrow();
    }
  });

  it('allows an explicit display name override reason', () => {
    expect(
      parseCatalogManifest({
        ...manifest,
        term: {
          ...manifest.term,
          display_name_override_reason: 'Registrar correction',
        },
      }).term.display_name_override_reason,
    ).toBe('Registrar correction');
  });

  it('hashes semantically identical manifests deterministically', () => {
    expect(hashCatalogManifest(parseCatalogManifest(manifest))).toBe(
      hashCatalogManifest(
        parseCatalogManifest({
          term: { ...manifest.term },
          source_system: 'course-management',
          schema_version: 1,
        }),
      ),
    );
  });
});
