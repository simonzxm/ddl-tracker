import { createHash } from 'node:crypto';

import {
  normalizePlainText,
  normalizedTextSchema,
  nullableNormalizedTextSchema,
} from '@ddl-tracker/contracts';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

const REQUIRED_HEADERS = [
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
] as const;

const optionalSourceTextSchema = z.string().max(10_000).nullable();

export const normalizedCatalogCourseSchema = z
  .object({
    external_course_code: z.string().trim().min(1).max(100),
    name: normalizedTextSchema(1, 300),
    credits: z.string().regex(/^\d+\.\d{2}$/u).nullable(),
  })
  .strict();

export const normalizedCatalogClassSectionSchema = z
  .object({
    external_section_id: z.string().trim().min(1).max(200),
    external_course_code: z.string().trim().min(1).max(100),
    name: normalizedTextSchema(1, 300),
    section_number: z.string().trim().min(1).max(100),
    department_code: z.string().trim().min(1).max(100).nullable(),
    department_name: nullableNormalizedTextSchema(300),
    instructors: z.array(normalizedTextSchema(1, 200)).max(100),
    campus_code: z.string().trim().min(1).max(100).nullable(),
    campus_name: nullableNormalizedTextSchema(300),
    capacity: z.number().int().nonnegative().max(2_147_483_647).nullable(),
    schedule_text: nullableNormalizedTextSchema(2000),
    weeks_text: nullableNormalizedTextSchema(500),
    weekday_text: nullableNormalizedTextSchema(100),
    periods_text: nullableNormalizedTextSchema(100),
    room_text: nullableNormalizedTextSchema(300),
    building_code: z.string().trim().min(1).max(100).nullable(),
    building_name: nullableNormalizedTextSchema(300),
    source_payload: z.record(z.string().max(200), optionalSourceTextSchema),
  })
  .strict();

export interface NormalizedCatalogTerm {
  external_code: string;
  display_name: string;
  starts_on: null;
  ends_on: null;
  time_zone: 'Asia/Shanghai';
}

export type NormalizedCatalogCourse = z.infer<
  typeof normalizedCatalogCourseSchema
>;
export type NormalizedCatalogClassSection = z.infer<
  typeof normalizedCatalogClassSectionSchema
>;

export interface ParsedCatalogCsv {
  metadata: {
    checksum: string;
    row_count: number;
    header_hash: string;
    warnings: string[];
  };
  term: NormalizedCatalogTerm;
  courses: NormalizedCatalogCourse[];
  class_sections: NormalizedCatalogClassSection[];
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeCell(value: string): string | null {
  const normalized = normalizePlainText(value);
  return normalized === '' ? null : normalized;
}

function requireCell(
  row: Record<string, string | null>,
  field: string,
  rowNumber: number,
): string {
  const value = row[field];
  if (value === null || value === undefined) {
    throw new Error(`Row ${String(rowNumber)} has an empty required field: ${field}.`);
  }
  return value;
}

function parseDecimal(
  value: string | null | undefined,
  field: string,
  rowNumber: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (!/^\d+(?:\.\d{1,2})?$/u.test(value)) {
    throw new Error(`Row ${String(rowNumber)} has an invalid ${field} decimal.`);
  }
  const [whole = '0', fraction = ''] = value.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/u, '');
  if (normalizedWhole.length > 3) {
    throw new Error(`Row ${String(rowNumber)} has an invalid ${field} decimal.`);
  }
  return `${normalizedWhole}.${fraction.padEnd(2, '0')}`;
}

function parseInteger(
  value: string | null | undefined,
  field: string,
  rowNumber: number,
): number | null {
  if (value === null || value === undefined) return null;
  if (!/^\d+$/u.test(value)) {
    throw new Error(`Row ${String(rowNumber)} has an invalid ${field} integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    throw new Error(`Row ${String(rowNumber)} has an out-of-range ${field}.`);
  }
  return parsed;
}

function splitInstructors(value: string | null | undefined): string[] {
  if (value === null || value === undefined) return [];
  return value
    .split(/[,，;；、]/u)
    .map((name) => normalizeCell(name))
    .filter((name): name is string => name !== null);
}

function sameCourseIdentity(
  left: NormalizedCatalogCourse,
  right: NormalizedCatalogCourse,
): boolean {
  return left.name === right.name && left.credits === right.credits;
}

export function parseCatalogCsv(
  bytes: Uint8Array,
  options: { expectedTermCode?: string } = {},
): ParsedCatalogCsv {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let matrix: string[][];
  try {
    matrix = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    });
  } catch (error) {
    throw new Error(
      `CSV parsing failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      { cause: error },
    );
  }

  const rawHeaders = matrix[0];
  if (rawHeaders === undefined) throw new Error('CSV is empty.');
  const headers = rawHeaders.map((header) => normalizePlainText(header));
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV contains duplicate header names.');
  }
  if (headers.length > REQUIRED_HEADERS.length + 100) {
    throw new Error('CSV contains more than 100 unknown columns.');
  }
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`Missing required CSV columns: ${missing.join(', ')}.`);
  }
  const required = new Set<string>(REQUIRED_HEADERS);
  const warnings = headers
    .filter((header) => !required.has(header))
    .map((header) => `Unknown CSV column: ${header}`);

  const dataRows = matrix.slice(1);
  if (dataRows.length === 0) {
    throw new Error('CSV contains no course rows.');
  }

  const courses = new Map<string, NormalizedCatalogCourse>();
  const sections = new Map<string, NormalizedCatalogClassSection>();
  let termCode: string | undefined;
  let termDisplayName: string | undefined;

  dataRows.forEach((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new Error(
        `Row ${String(rowNumber)} has ${String(values.length)} fields; expected ${String(headers.length)}.`,
      );
    }
    const row: Record<string, string | null> = {};
    headers.forEach((header, columnIndex) => {
      row[header] = normalizeCell(values[columnIndex] ?? '');
    });

    const rowTermCode = requireCell(row, 'XNXQDM', rowNumber);
    const rowDisplayName = requireCell(row, 'XNXQDM_DISPLAY', rowNumber);
    termCode ??= rowTermCode;
    termDisplayName ??= rowDisplayName;
    if (rowTermCode !== termCode) {
      throw new Error(`Row ${String(rowNumber)} has a conflicting XNXQDM term code.`);
    }
    if (rowDisplayName !== termDisplayName) {
      throw new Error(`Row ${String(rowNumber)} has a conflicting term display name.`);
    }
    if (
      options.expectedTermCode !== undefined &&
      rowTermCode !== options.expectedTermCode
    ) {
      throw new Error(
        `CSV term ${rowTermCode} does not match expected term ${options.expectedTermCode}.`,
      );
    }

    const courseCode = requireCell(row, 'KCH', rowNumber);
    const course = normalizedCatalogCourseSchema.parse({
      external_course_code: courseCode,
      name: requireCell(row, 'KCM', rowNumber),
      credits: parseDecimal(row.XF, 'XF', rowNumber),
    });
    const existingCourse = courses.get(courseCode);
    if (existingCourse !== undefined && !sameCourseIdentity(existingCourse, course)) {
      throw new Error(
        `Conflicting course facts for KCH ${courseCode} at row ${String(rowNumber)}.`,
      );
    }
    courses.set(courseCode, existingCourse ?? course);

    const sectionId = requireCell(row, 'JXBID', rowNumber);
    if (sections.has(sectionId)) {
      throw new Error(`Duplicate JXBID ${sectionId} at row ${String(rowNumber)}.`);
    }
    sections.set(
      sectionId,
      normalizedCatalogClassSectionSchema.parse({
        external_section_id: sectionId,
        external_course_code: courseCode,
        name: requireCell(row, 'JXBMC', rowNumber),
        section_number: requireCell(row, 'KXH', rowNumber),
        department_code: row.PKDWDM ?? null,
        department_name: row.PKDWDM_DISPLAY ?? null,
        instructors: splitInstructors(row.SKJS),
        campus_code: row.XXXQDM ?? null,
        campus_name: row.XXXQDM_DISPLAY ?? null,
        capacity: parseInteger(row.XKZRS, 'XKZRS', rowNumber),
        schedule_text: row.YPSJDD ?? null,
        weeks_text: row.SKZC ?? null,
        weekday_text: row.SKXQ ?? null,
        periods_text: row.SKJC ?? null,
        room_text: row.SKJAS ?? null,
        building_code: row.JXLDM ?? null,
        building_name: row.JXLDM_DISPLAY ?? null,
        source_payload: row,
      }),
    );
  });

  if (termCode === undefined || termDisplayName === undefined) {
    throw new Error('CSV term identity could not be derived.');
  }

  return {
    metadata: {
      checksum: sha256(bytes),
      row_count: dataRows.length,
      header_hash: sha256(headers.join('\u0000')),
      warnings,
    },
    term: {
      external_code: termCode,
      display_name: termDisplayName,
      starts_on: null,
      ends_on: null,
      time_zone: 'Asia/Shanghai',
    },
    courses: [...courses.values()].sort((left, right) =>
      left.external_course_code.localeCompare(right.external_course_code),
    ),
    class_sections: [...sections.values()].sort((left, right) =>
      left.external_section_id.localeCompare(right.external_section_id),
    ),
  };
}
