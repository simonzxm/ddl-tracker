import { describe, expect, it } from 'vitest';

import {
  buildCatalogDiff,
  hasCatalogChanges,
  hashCatalogBaseline,
  type CatalogBaseline,
  type DesiredCatalog,
} from '../src/catalog/catalog-diff.js';

const baseline: CatalogBaseline = {
  term: {
    id: '018f0000-0000-7000-8000-000000000401',
    externalCode: '2026-2027-1',
    name: 'Old Term',
    startsOn: null,
    endsOn: null,
  },
  courses: [
    {
      id: '018f0000-0000-7000-8000-000000000402',
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
      id: '018f0000-0000-7000-8000-000000000403',
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
    starts_on: null,
    ends_on: null,
    time_zone: 'Asia/Shanghai',
  },
  courses: [
    { external_course_code: '0010', name: 'New Course', credits: '3.00' },
    { external_course_code: '0020', name: 'Added Course', credits: null },
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

describe('catalog sync diff', () => {
  it('counts additions, updates, and deactivations', () => {
    const diff = buildCatalogDiff(desired, baseline);

    expect(diff).toMatchObject({
      terms: { added: 0, updated: 1, unchanged: 0, deactivated: 0 },
      courses: { added: 1, updated: 1, unchanged: 0, deactivated: 1 },
      class_sections: {
        added: 1,
        updated: 1,
        unchanged: 0,
        deactivated: 1,
      },
    });
    expect(diff.field_changes).toMatchObject({
      'terms.name': 1,
      'courses.name': 1,
      'class_sections.capacity': 1,
      'class_sections.department_code': 1,
      'class_sections.department_name': 1,
      'class_sections.schedule_text': 1,
    });
    expect(hasCatalogChanges(diff)).toBe(true);
  });

  it('recognizes an unchanged catalog and hashes baselines deterministically', () => {
    const unchanged = buildCatalogDiff(
      {
        term: {
          external_code: '2026-2027-1',
          display_name: 'Old Term',
          starts_on: null,
          ends_on: null,
          time_zone: 'Asia/Shanghai',
        },
        courses: [
          { external_course_code: '0010', name: 'Old Course', credits: '3.00' },
          { external_course_code: '0099', name: 'Missing Course', credits: null },
        ],
        classSections: baseline.classSections.map((section) => ({
          external_section_id: section.externalSectionId,
          external_course_code: section.externalCourseCode,
          name: 'Section',
          section_number: section.sectionNumber,
          department_code: section.departmentCode,
          department_name: section.departmentName,
          instructors: section.instructors,
          campus_code: null,
          campus_name: section.campus,
          capacity: section.capacity,
          schedule_text: section.scheduleText,
          weeks_text: null,
          weekday_text: null,
          periods_text: null,
          room_text: null,
          building_code: null,
          building_name: null,
          source_payload: {},
        })),
      },
      baseline,
    );

    expect(hasCatalogChanges(unchanged)).toBe(false);
    expect(hashCatalogBaseline(baseline)).toBe(
      hashCatalogBaseline({
        ...baseline,
        courses: [...baseline.courses].reverse(),
        classSections: [...baseline.classSections].reverse(),
      }),
    );
  });
});
