import { createHash } from 'node:crypto';

import {
  normalizePlainText,
  normalizedCatalogClassSectionSchema,
  normalizedCatalogCourseSchema,
} from '@ddl-tracker/contracts';
import { parse } from 'csv-parse/sync';

import { hashCatalogManifest, type CatalogManifest } from './manifest.js';

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

export interface NormalizedCatalogCourse {
  external_course_code: string;
  name: string;
  credits: string | null;
}

export interface NormalizedCatalogClassSection {
  external_section_id: string;
  external_course_code: string;
  name: string;
  section_number: string;
  department_code: string | null;
  department_name: string | null;
  instructors: string[];
  campus_code: string | null;
  campus_name: string | null;
  capacity: number | null;
  schedule_text: string | null;
  weeks_text: string | null;
  weekday_text: string | null;
  periods_text: string | null;
  room_text: string | null;
  building_code: string | null;
  building_name: string | null;
  source_payload: Record<string, string | null>;
}

export interface ParsedCatalogCsv {
  metadata: {
    checksum: string;
    row_count: number;
    header_hash: string;
    manifest_hash: string;
    warnings: string[];
  };
  term: {
    external_code: string;
    display_name: string;
    starts_on: string;
    ends_on: string;
    time_zone: 'Asia/Shanghai';
  };
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
  if (value === null || value === undefined) {
    return null;
  }
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
  if (value === null || value === undefined) {
    return null;
  }
  if (!/^\d+$/u.test(value)) {
    throw new Error(`Row ${String(rowNumber)} has an invalid ${field} integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Row ${String(rowNumber)} has an out-of-range ${field}.`);
  }
  return parsed;
}

function splitInstructors(value: string | null | undefined): string[] {
  if (value === null || value === undefined) {
    return [];
  }
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
  manifest: CatalogManifest,
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
  if (rawHeaders === undefined) {
    throw new Error('CSV is empty.');
  }
  const headers = rawHeaders.map((header) => normalizePlainText(header));
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV contains duplicate header names.');
  }
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`Missing required CSV columns: ${missing.join(', ')}.`);
  }
  const required = new Set<string>(REQUIRED_HEADERS);
  const warnings = headers
    .filter((header) => !required.has(header))
    .map((header) => `Unknown CSV column: ${header}`);

  const courses = new Map<string, NormalizedCatalogCourse>();
  const sections = new Map<string, NormalizedCatalogClassSection>();
  const dataRows = matrix.slice(1);

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

    const termCode = requireCell(row, 'XNXQDM', rowNumber);
    if (termCode !== manifest.term.external_code) {
      throw new Error(
        `Row ${String(rowNumber)} XNXQDM does not match the manifest term code.`,
      );
    }
    const termDisplayName = requireCell(row, 'XNXQDM_DISPLAY', rowNumber);
    if (
      termDisplayName !== manifest.term.display_name &&
      manifest.term.display_name_override_reason === undefined
    ) {
      throw new Error(
        `Row ${String(rowNumber)} term display name does not match the manifest.`,
      );
    }

    const courseCode = requireCell(row, 'KCH', rowNumber);
    const course: NormalizedCatalogCourse = {
      external_course_code: courseCode,
      name: requireCell(row, 'KCM', rowNumber),
      credits: parseDecimal(row.XF, 'XF', rowNumber),
    };
    const existingCourse = courses.get(courseCode);
    if (
      existingCourse !== undefined &&
      !sameCourseIdentity(existingCourse, course)
    ) {
      throw new Error(
        `Conflicting course facts for KCH ${courseCode} at row ${String(rowNumber)}.`,
      );
    }
    if (existingCourse === undefined) {
      courses.set(courseCode, course);
    }

    const sectionId = requireCell(row, 'JXBID', rowNumber);
    if (sections.has(sectionId)) {
      throw new Error(`Duplicate JXBID ${sectionId} at row ${String(rowNumber)}.`);
    }
    sections.set(sectionId, {
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
    });
  });

  return {
    metadata: {
      checksum: sha256(bytes),
      row_count: dataRows.length,
      header_hash: sha256(headers.join('\u0000')),
      manifest_hash: hashCatalogManifest(manifest),
      warnings,
    },
    term: {
      external_code: manifest.term.external_code,
      display_name: manifest.term.display_name,
      starts_on: manifest.term.starts_on,
      ends_on: manifest.term.ends_on,
      time_zone: manifest.term.time_zone,
    },
    courses: [...courses.values()]
      .sort((left, right) =>
        left.external_course_code.localeCompare(right.external_course_code),
      )
      .map((course) => normalizedCatalogCourseSchema.parse(course)),
    class_sections: [...sections.values()]
      .sort((left, right) =>
        left.external_section_id.localeCompare(right.external_section_id),
      )
      .map((section) => normalizedCatalogClassSectionSchema.parse(section)),
  };
}
