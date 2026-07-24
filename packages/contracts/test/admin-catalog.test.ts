import { describe, expect, it } from 'vitest';

import {
  catalogApplyRequestSchema,
  catalogPlanBatchRequestSchema,
} from '../src/admin-catalog.js';

const ID = '018f0000-0000-7000-8000-000000000001';
const HASH = 'a'.repeat(64);
const TERM = {
  external_code: '2026-2027-1',
  display_name: '2026-2027学年 第1学期',
  starts_on: '2026-08-31',
  ends_on: '2027-01-17',
  time_zone: 'Asia/Shanghai' as const,
};

describe('admin catalog import contracts', () => {
  it('validates the first bounded plan batch', () => {
    expect(
      catalogPlanBatchRequestSchema.parse({
        import_id: null,
        filename: 'fixture.csv',
        checksum: HASH,
        header_hash: HASH,
        manifest_hash: HASH,
        environment: 'staging',
        manifest: { schema_version: 1 },
        term: TERM,
        row_count: 1,
        batch_index: 0,
        total_batches: 1,
        finalize: true,
        courses: [
          {
            external_course_code: '0010',
            name: 'Course',
            credits: '3.50',
          },
        ],
        class_sections: [
          {
            external_section_id: 'section-1',
            external_course_code: '0010',
            name: 'Section',
            section_number: '01',
            department_code: '001',
            department_name: 'Department',
            instructors: [],
            campus_code: null,
            campus_name: null,
            capacity: null,
            schedule_text: null,
            weeks_text: null,
            weekday_text: null,
            periods_text: null,
            room_text: null,
            building_code: null,
            building_name: null,
            source_payload: { KCH: '0010' },
          },
        ],
      }),
    ).toMatchObject({ batch_index: 0, finalize: true });
  });

  it('requires an import ID after the first batch', () => {
    expect(() =>
      catalogPlanBatchRequestSchema.parse({
        import_id: null,
        filename: 'fixture.csv',
        checksum: HASH,
        header_hash: HASH,
        manifest_hash: HASH,
        environment: 'staging',
        manifest: {},
        term: TERM,
        row_count: 2,
        batch_index: 1,
        total_batches: 2,
        finalize: true,
        courses: [],
        class_sections: [],
      }),
    ).toThrow();
  });

  it('limits normalized records per request', () => {
    const section = {
      external_section_id: 'section-1',
      external_course_code: '0010',
      name: 'Section',
      section_number: '01',
      instructors: [],
      campus_code: null,
      campus_name: null,
      capacity: null,
      schedule_text: null,
      weeks_text: null,
      weekday_text: null,
      periods_text: null,
      room_text: null,
      building_code: null,
      building_name: null,
      source_payload: {},
    };
    expect(() =>
      catalogPlanBatchRequestSchema.parse({
        import_id: ID,
        filename: 'fixture.csv',
        checksum: HASH,
        header_hash: HASH,
        manifest_hash: HASH,
        environment: 'staging',
        manifest: {},
        term: TERM,
        row_count: 501,
        batch_index: 1,
        total_batches: 3,
        finalize: false,
        courses: [],
        class_sections: Array.from({ length: 501 }, () => section),
      }),
    ).toThrow();
  });

  it('requires explicit deactivation confirmation during apply', () => {
    expect(
      catalogApplyRequestSchema.parse({
        batch_index: 0,
        confirm_deactivations: false,
      }),
    ).toEqual({ batch_index: 0, confirm_deactivations: false });
  });
});
