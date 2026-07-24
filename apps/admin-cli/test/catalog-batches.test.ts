import { describe, expect, it } from 'vitest';

import { splitCatalogBatches } from '../src/catalog/batches.js';

function course(index: number) {
  return {
    external_course_code: String(index).padStart(4, '0'),
    name: `Course ${String(index)}`,
    credits: null,
  };
}

function section(index: number, payload = '') {
  return {
    external_section_id: `section-${String(index)}`,
    external_course_code: String(index).padStart(4, '0'),
    name: `Section ${String(index)}`,
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
    source_payload: { EXTRA: payload },
  };
}

describe('splitCatalogBatches', () => {
  it('keeps all records exactly once in deterministic order', () => {
    const courses = Array.from({ length: 620 }, (_, index) => course(index));
    const sections = Array.from({ length: 620 }, (_, index) => section(index));

    const batches = splitCatalogBatches(courses, sections, {
      maximumRecordsPerType: 500,
      maximumPayloadBytes: 10_000_000,
    });

    expect(batches).toHaveLength(2);
    expect(batches[0]?.courses).toHaveLength(500);
    expect(batches[0]?.class_sections).toHaveLength(500);
    expect(batches.flatMap((batch) => batch.courses)).toEqual(courses);
    expect(batches.flatMap((batch) => batch.class_sections)).toEqual(sections);
  });

  it('splits early when the encoded payload reaches the byte budget', () => {
    const courses = [course(0), course(1)];
    const sections = [section(0, 'x'.repeat(600)), section(1, 'y'.repeat(600))];

    const batches = splitCatalogBatches(courses, sections, {
      maximumRecordsPerType: 500,
      maximumPayloadBytes: 1_200,
    });

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(
        new TextEncoder().encode(JSON.stringify(batch)).byteLength,
      ).toBeLessThanOrEqual(1_200);
    }
  });

  it('returns one empty batch for an empty catalog', () => {
    expect(
      splitCatalogBatches([], [], {
        maximumRecordsPerType: 500,
        maximumPayloadBytes: 1_000,
      }),
    ).toEqual([{ courses: [], class_sections: [] }]);
  });

  it('rejects a single record that cannot fit the request budget', () => {
    expect(() =>
      splitCatalogBatches([], [section(0, 'x'.repeat(10_000))], {
        maximumRecordsPerType: 500,
        maximumPayloadBytes: 500,
      }),
    ).toThrow('single catalog record');
  });
});
