import { describe, expect, it } from 'vitest';

import { parseCatalogCsv } from '../src/catalog/csv.js';
import { parseCatalogManifest } from '../src/catalog/manifest.js';

const manifest = parseCatalogManifest({
  schema_version: 1,
  source_system: 'course-management',
  term: {
    external_code: '2026-2027-1',
    display_name: '2026-2027学年 第1学期',
    starts_on: '2026-08-31',
    ends_on: '2027-01-17',
    time_zone: 'Asia/Shanghai',
  },
});

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
  it('parses BOM, quoted commas, leading zeros, instructors, and source payload', () => {
    const result = parseCatalogCsv(csv(row()), manifest);

    expect(result.metadata.row_count).toBe(1);
    expect(result.metadata.checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.courses).toEqual([
      expect.objectContaining({
        external_course_code: '0010',
        name: 'Course, Advanced',
        credits: '3.50',
      }),
    ]);
    expect(result.courses[0]).not.toHaveProperty('department_code');
    expect(result.courses[0]).not.toHaveProperty('department_name');
    expect(result.class_sections).toEqual([
      expect.objectContaining({
        external_section_id: 'section-1',
        section_number: '01',
        department_code: '001',
        department_name: 'Department',
        instructors: ['Teacher A', 'Teacher B'],
        capacity: 30,
        schedule_text: 'Thursday 9-11, Room 1',
        source_payload: expect.objectContaining({ KCH: '0010' }),
      }),
    ]);
  });

  it('warns about and preserves unknown extra columns', () => {
    const extendedHeaders = [...headers, 'NEW_FIELD'];
    const bytes = new TextEncoder().encode(
      `${extendedHeaders.join(',')}\n${row()},extra\n`,
    );
    const result = parseCatalogCsv(bytes, manifest);

    expect(result.metadata.warnings).toContain('Unknown CSV column: NEW_FIELD');
    expect(result.class_sections[0]?.source_payload['NEW_FIELD']).toBe('extra');
  });

  it('converts empty optional values to null', () => {
    const result = parseCatalogCsv(
      csv(row({ XF: '', SKJS: '', XKZRS: '', YPSJDD: '' })),
      manifest,
    );

    expect(result.courses[0]?.credits).toBeNull();
    expect(result.class_sections[0]).toMatchObject({
      instructors: [],
      capacity: null,
      schedule_text: null,
    });
  });

  it('canonicalizes credits to the database scale', () => {
    const whole = parseCatalogCsv(csv(row({ XF: '3' })), manifest);
    const fractional = parseCatalogCsv(csv(row({ XF: '3.5' })), manifest);

    expect(whole.courses[0]?.credits).toBe('3.00');
    expect(fractional.courses[0]?.credits).toBe('3.50');
  });

  it('rejects missing required headers and invalid numerics', () => {
    const missing = new TextEncoder().encode('XNXQDM,KCH\n2026-2027-1,0010\n');
    expect(() => parseCatalogCsv(missing, manifest)).toThrow('Missing required');
    expect(() =>
      parseCatalogCsv(csv(row({ XF: 'three' })), manifest),
    ).toThrow('XF');
    expect(() =>
      parseCatalogCsv(csv(row({ XF: '3.555' })), manifest),
    ).toThrow('XF');
    expect(() =>
      parseCatalogCsv(csv(row({ XF: '1000' })), manifest),
    ).toThrow('XF');
    expect(() =>
      parseCatalogCsv(csv(row({ XKZRS: '-1' })), manifest),
    ).toThrow('XKZRS');
  });

  it('rejects duplicate section keys and conflicting course facts', () => {
    expect(() => parseCatalogCsv(csv(row(), row()), manifest)).toThrow(
      'JXBID',
    );
    expect(() =>
      parseCatalogCsv(
        csv(
          row(),
          row({ JXBID: 'section-2', KCM: 'Different Course' }),
        ),
        manifest,
      ),
    ).toThrow('Conflicting course');
  });

  it('keeps different offering departments on their class sections', () => {
    const result = parseCatalogCsv(
      csv(
        row(),
        row({
          JXBID: 'section-2',
          PKDWDM: '002',
          PKDWDM_DISPLAY: 'Other Department',
        }),
      ),
      manifest,
    );

    expect(result.metadata.warnings).toEqual([]);
    expect(result.class_sections).toEqual([
      expect.objectContaining({
        department_code: '001',
        department_name: 'Department',
        source_payload: expect.objectContaining({ PKDWDM: '001' }),
      }),
      expect.objectContaining({
        department_code: '002',
        department_name: 'Other Department',
        source_payload: expect.objectContaining({ PKDWDM: '002' }),
      }),
    ]);
  });

  it('rejects term code and display name mismatches without an override', () => {
    expect(() =>
      parseCatalogCsv(csv(row({ XNXQDM: 'other' })), manifest),
    ).toThrow('XNXQDM');
    expect(() =>
      parseCatalogCsv(csv(row({ XNXQDM_DISPLAY: 'Other Name' })), manifest),
    ).toThrow('display name');
  });
});
