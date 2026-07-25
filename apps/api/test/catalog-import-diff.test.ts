import { describe, expect, it } from 'vitest';

import {
  buildCatalogImportDiff,
  hashCatalogBaseline,
  type CatalogBaseline,
  type DesiredCatalog,
} from '../src/catalog/import-diff.js';

const TERM_ID = '018f0000-0000-7000-8000-000000000401';
const COURSE_ID = '018f0000-0000-7000-8000-000000000402';
const SECTION_ID = '018f0000-0000-7000-8000-000000000403';

const baseline: CatalogBaseline = {
  term: {
    id: TERM_ID,
    externalCode: '2026-2027-1',
    name: 'Old Term',
    startsOn: '2026-08-31',
    endsOn: '2027-01-17',
  },
  courses: [
    {
      id: COURSE_ID,
      externalCourseCode: '0010',
      name: 'Old Course',
      credits: '3.00',
      active: true,
      revision: 1,
    },
    {
      id: '018f0000-0000-7000-8000-000000000404',
      externalCourseCode: '0099',
      name: 'Missing Course',
      credits: null,
      active: true,
      revision: 1,
    },
  ],
  classSections: [
    {
      id: SECTION_ID,
      externalSectionId: 'section-1',
      externalCourseCode: '0010',
      sectionNumber: '01',
      departmentCode: '001',
      departmentName: 'Old Department',
      instructors: ['Teacher'],
      campus: null,
      capacity: 20,
      scheduleText: 'Old Schedule',
      active: true,
      revision: 1,
    },
    {
      id: '018f0000-0000-7000-8000-000000000405',
      externalSectionId: 'section-missing',
      externalCourseCode: '0010',
      sectionNumber: '02',
      departmentCode: null,
      departmentName: null,
      instructors: [],
      campus: null,
      capacity: null,
      scheduleText: null,
      active: true,
      revision: 1,
    },
  ],
};

const desired: DesiredCatalog = {
  term: {
    external_code: '2026-2027-1',
    display_name: 'New Term',
    starts_on: '2026-08-31',
    ends_on: '2027-01-17',
    time_zone: 'Asia/Shanghai',
  },
  courses: [
    {
      external_course_code: '0010',
      name: 'New Course',
      credits: '3.00',
    },
    {
      external_course_code: '0020',
      name: 'Added Course',
      credits: null,
    },
  ],
  classSections: [
    {
      external_section_id: 'section-1',
      external_course_code: '0010',
      name: 'Section',
      section_number: '01',
      department_code: '002',
      department_name: 'New Department',
      instructors: ['Teacher'],
      campus_code: null,
      campus_name: null,
      capacity: 30,
      schedule_text: 'New Schedule',
      weeks_text: null,
      weekday_text: null,
      periods_text: null,
      room_text: null,
      building_code: null,
      building_name: null,
      source_payload: {},
    },
    {
      external_section_id: 'section-2',
      external_course_code: '0020',
      name: 'Section 2',
      section_number: '01',
      department_code: null,
      department_name: null,
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
    },
  ],
};

describe('catalog import diff', () => {
  it('counts additions, updates, unchanged records, and deactivations', () => {
    const diff = buildCatalogImportDiff(desired, baseline, false);

    expect(diff).toMatchObject({
      terms: { added: 0, updated: 1, unchanged: 0, deactivated: 0 },
      courses: { added: 1, updated: 1, unchanged: 0, deactivated: 1 },
      class_sections: {
        added: 1,
        updated: 1,
        unchanged: 0,
        deactivated: 1,
      },
      checksum_previously_applied: false,
    });
    expect(diff.field_changes).toMatchObject({
      'terms.name': 1,
      'courses.name': 1,
      'class_sections.capacity': 1,
      'class_sections.department_code': 1,
      'class_sections.department_name': 1,
      'class_sections.schedule_text': 1,
    });
    expect(diff.deactivated_class_section_ids).toEqual([
      '018f0000-0000-7000-8000-000000000405',
    ]);
    expect(diff.deactivated_courses).toEqual([
      {
        id: '018f0000-0000-7000-8000-000000000404',
        external_course_code: '0099',
      },
    ]);
    expect(diff.deactivated_class_sections).toEqual([
      {
        id: '018f0000-0000-7000-8000-000000000405',
        external_section_id: 'section-missing',
      },
    ]);
  });

  it('marks identical desired records unchanged', () => {
    const desiredSection = desired.classSections[0];
    const baselineCourse = baseline.courses[0];
    const baselineSection = baseline.classSections[0];
    if (
      desiredSection === undefined ||
      baselineCourse === undefined ||
      baselineSection === undefined
    ) {
      throw new Error('Expected catalog fixtures.');
    }
    const identical: DesiredCatalog = {
      term: {
        external_code: '2026-2027-1',
        display_name: 'Old Term',
        starts_on: '2026-08-31',
        ends_on: '2027-01-17',
        time_zone: 'Asia/Shanghai',
      },
      courses: [
        {
          external_course_code: '0010',
          name: 'Old Course',
          credits: '3.00',
        },
      ],
      classSections: [
        {
          ...desiredSection,
          capacity: 20,
          department_code: '001',
          department_name: 'Old Department',
          schedule_text: 'Old Schedule',
        },
      ],
    };

    const diff = buildCatalogImportDiff(
      identical,
      {
        ...baseline,
        courses: [baselineCourse],
        classSections: [baselineSection],
      },
      true,
    );

    expect(diff).toMatchObject({
      terms: { unchanged: 1 },
      courses: { unchanged: 1 },
      class_sections: { unchanged: 1 },
      checksum_previously_applied: true,
    });
  });

  it('hashes the sorted baseline deterministically', () => {
    expect(hashCatalogBaseline(baseline)).toBe(
      hashCatalogBaseline({
        ...baseline,
        courses: [...baseline.courses].reverse(),
        classSections: [...baseline.classSections].reverse(),
      }),
    );
  });
});
