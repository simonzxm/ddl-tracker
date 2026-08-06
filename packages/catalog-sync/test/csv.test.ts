import { describe, expect, it } from 'vitest';

import { parseCatalogCsv } from '../src/index.js';

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

function row(overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    XNXQDM: '2026-2027-1',
    XNXQDM_DISPLAY: '2026-2027学年 第1学期',
    KCH: '0010',
    KCM: 'Course, Advanced',
    XF: '3.50',
    PKDWDM: '001',
    PKDWDM_DISPLAY: 'Department',
    JXBID: 'section-1',
    JXBMC: 'Section 01',
    KXH: '01',
    SKJS: 'Teacher A、Teacher B',
    XXXQDM: '01',
    XXXQDM_DISPLAY: 'Campus',
    XKZRS: '30',
    YPSJDD: 'Thursday 9-11, Room 1',
    SKZC: '1-18',
    SKXQ: '4',
    SKJC: '9-11',
    SKJAS: 'Room 1',
    JXLDM: 'B01',
    JXLDM_DISPLAY: 'Building',
    ...overrides,
  };
  return headers
    .map((header) => {
      const value = values[header] ?? '';
      return /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    })
    .join(',');
}

function csv(...rows: string[]): Uint8Array {
  return new TextEncoder().encode(`\uFEFF${headers.join(',')}\n${rows.join('\n')}\n`);
}

describe('parseCatalogCsv', () => {
  it('derives the academic term from the upstream CSV without a manifest', () => {
    const result = parseCatalogCsv(csv(row()), {
      expectedTermCode: '2026-2027-1',
    });

    expect(result.term).toEqual({
      external_code: '2026-2027-1',
      display_name: '2026-2027学年 第1学期',
      starts_on: null,
      ends_on: null,
      time_zone: 'Asia/Shanghai',
    });
    expect(result.metadata).toMatchObject({ row_count: 1, warnings: [] });
    expect(result.metadata.checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.courses).toEqual([
      {
        external_course_code: '0010',
        name: 'Course, Advanced',
        credits: '3.50',
      },
    ]);
    expect(result.class_sections).toEqual([
      expect.objectContaining({
        external_section_id: 'section-1',
        external_course_code: '0010',
        section_number: '01',
        instructors: ['Teacher A', 'Teacher B'],
        source_payload: expect.objectContaining({ KCH: '0010' }),
      }),
    ]);
  });

  it('rejects an upstream path and CSV term mismatch', () => {
    expect(() =>
      parseCatalogCsv(csv(row()), { expectedTermCode: '2025-2026-2' }),
    ).toThrow('expected term');
  });

  it('rejects mixed term identities, duplicate sections, and conflicting courses', () => {
    expect(() =>
      parseCatalogCsv(
        csv(row(), row({ JXBID: 'section-2', XNXQDM_DISPLAY: 'Other' })),
      ),
    ).toThrow('display name');
    expect(() => parseCatalogCsv(csv(row(), row()))).toThrow('JXBID');
    expect(() =>
      parseCatalogCsv(
        csv(row(), row({ JXBID: 'section-2', KCM: 'Different Course' })),
      ),
    ).toThrow('Conflicting course');
  });

  it('preserves unknown columns and strictly parses optional numbers', () => {
    const extendedHeaders = [...headers, 'NEW_FIELD'];
    const bytes = new TextEncoder().encode(
      `${extendedHeaders.join(',')}\n${row({ XF: '3', XKZRS: '' })},extra\n`,
    );
    const result = parseCatalogCsv(bytes);

    expect(result.metadata.warnings).toEqual(['Unknown CSV column: NEW_FIELD']);
    expect(result.courses[0]?.credits).toBe('3.00');
    expect(result.class_sections[0]).toMatchObject({
      capacity: null,
      source_payload: expect.objectContaining({ NEW_FIELD: 'extra' }),
    });
    expect(() => parseCatalogCsv(csv(row({ XF: '3.555' })))).toThrow('XF');
    expect(() => parseCatalogCsv(csv(row({ XKZRS: '-1' })))).toThrow('XKZRS');
  });

  it('rejects empty data and missing required headers', () => {
    expect(() =>
      parseCatalogCsv(new TextEncoder().encode(`${headers.join(',')}\n`)),
    ).toThrow('no course rows');
    expect(() =>
      parseCatalogCsv(
        new TextEncoder().encode('XNXQDM,KCH\n2026-2027-1,0010\n'),
      ),
    ).toThrow('Missing required');
  });
});
