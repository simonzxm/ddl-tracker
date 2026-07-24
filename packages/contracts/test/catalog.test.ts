import { describe, expect, it } from 'vitest';

import {
  classSectionSchema,
  courseSchema,
  termSchema,
} from '../src/catalog.js';

const ID = '018f0000-0000-7000-8000-000000000001';

describe('catalog contracts', () => {
  it('validates public term records', () => {
    expect(
      termSchema.parse({
        id: ID,
        external_code: '2026-2027-1',
        name: '2026-2027学年 第1学期',
        starts_on: '2026-08-31',
        ends_on: '2027-01-17',
        status: 'upcoming',
      }),
    ).toMatchObject({ status: 'upcoming' });
  });

  it('keeps course external codes and decimal credits as strings', () => {
    expect(
      courseSchema.parse({
        id: ID,
        external_course_code: '001234',
        name: 'Course',
        credits: '3.50',
        department: 'Department',
      }),
    ).toMatchObject({ external_course_code: '001234', credits: '3.50' });
  });

  it('exposes current section fields without raw source payloads', () => {
    expect(
      classSectionSchema.parse({
        id: ID,
        external_section_id: 'section-1',
        section_number: '01',
        department_code: '001',
        department_name: 'Department',
        instructors: ['Teacher'],
        campus: null,
        capacity: 30,
        schedule_text: 'Thursday 9-11',
        active: true,
        revision: 1,
      }),
    ).toMatchObject({ section_number: '01', revision: 1 });
    expect(() =>
      classSectionSchema.parse({
        id: ID,
        external_section_id: 'section-1',
        section_number: '01',
        instructors: [],
        campus: null,
        capacity: null,
        schedule_text: null,
        active: true,
        revision: 1,
        raw_source: { private: true },
      }),
    ).toThrow();
  });
});
