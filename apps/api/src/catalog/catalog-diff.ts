import { createHash } from 'node:crypto';

import type {
  NormalizedCatalogClassSection,
  NormalizedCatalogCourse,
  NormalizedCatalogTerm,
} from '@ddl-tracker/catalog-sync';

export interface BaselineTerm {
  id: string;
  externalCode: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
}

export interface BaselineCourse {
  id: string;
  externalCourseCode: string;
  name: string;
  credits: string | null;
  active: boolean;
  revision: number;
}

export interface BaselineClassSection {
  id: string;
  externalSectionId: string;
  externalCourseCode: string;
  sectionNumber: string;
  departmentCode: string | null;
  departmentName: string | null;
  instructors: string[];
  campus: string | null;
  capacity: number | null;
  scheduleText: string | null;
  active: boolean;
  revision: number;
}

export interface CatalogBaseline {
  term: BaselineTerm | null;
  courses: BaselineCourse[];
  classSections: BaselineClassSection[];
}

export interface DesiredCatalog {
  term: NormalizedCatalogTerm;
  courses: NormalizedCatalogCourse[];
  classSections: NormalizedCatalogClassSection[];
}

export interface CatalogDiffCounts {
  added: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

export interface CatalogDiff {
  terms: CatalogDiffCounts;
  courses: CatalogDiffCounts;
  class_sections: CatalogDiffCounts;
  field_changes: Record<string, number>;
  deactivated_courses: {
    id: string;
    external_course_code: string;
  }[];
  deactivated_class_sections: {
    id: string;
    external_section_id: string;
  }[];
}

function emptyCounts(): CatalogDiffCounts {
  return { added: 0, updated: 0, unchanged: 0, deactivated: 0 };
}

function incrementChange(changes: Record<string, number>, field: string): void {
  changes[field] = (changes[field] ?? 0) + 1;
}

function compareField<T>(
  changes: Record<string, number>,
  field: string,
  current: T,
  desired: T,
): boolean {
  if (current === desired) return false;
  incrementChange(changes, field);
  return true;
}

function compareArrayField(
  changes: Record<string, number>,
  field: string,
  current: readonly string[],
  desired: readonly string[],
): boolean {
  return compareField(
    changes,
    field,
    JSON.stringify(current),
    JSON.stringify(desired),
  );
}

function uniqueMap<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const value of values) {
    const currentKey = key(value);
    if (map.has(currentKey)) {
      throw new Error(`Duplicate ${label}: ${currentKey}.`);
    }
    map.set(currentKey, value);
  }
  return map;
}

export function buildCatalogDiff(
  desired: DesiredCatalog,
  baseline: CatalogBaseline,
): CatalogDiff {
  const fieldChanges: Record<string, number> = {};
  const termCounts = emptyCounts();
  const courseCounts = emptyCounts();
  const sectionCounts = emptyCounts();
  const deactivatedCourses: CatalogDiff['deactivated_courses'] = [];
  const deactivatedSections: CatalogDiff['deactivated_class_sections'] = [];

  if (baseline.term === null) {
    termCounts.added = 1;
  } else {
    const changed = [
      compareField(
        fieldChanges,
        'terms.name',
        baseline.term.name,
        desired.term.display_name,
      ),
      compareField(
        fieldChanges,
        'terms.starts_on',
        baseline.term.startsOn,
        desired.term.starts_on,
      ),
      compareField(
        fieldChanges,
        'terms.ends_on',
        baseline.term.endsOn,
        desired.term.ends_on,
      ),
    ].some(Boolean);
    termCounts[changed ? 'updated' : 'unchanged'] += 1;
  }

  const desiredCourses = uniqueMap(
    desired.courses,
    (course) => course.external_course_code,
    'course external code',
  );
  const baselineCourses = uniqueMap(
    baseline.courses,
    (course) => course.externalCourseCode,
    'baseline course external code',
  );
  for (const course of desired.courses) {
    const current = baselineCourses.get(course.external_course_code);
    if (current === undefined) {
      courseCounts.added += 1;
      continue;
    }
    const changed = [
      compareField(
        fieldChanges,
        'courses.name',
        current.name,
        course.name,
      ),
      compareField(
        fieldChanges,
        'courses.credits',
        current.credits,
        course.credits,
      ),
      compareField(fieldChanges, 'courses.active', current.active, true),
    ].some(Boolean);
    courseCounts[changed ? 'updated' : 'unchanged'] += 1;
  }
  for (const course of baseline.courses) {
    if (course.active && !desiredCourses.has(course.externalCourseCode)) {
      courseCounts.deactivated += 1;
      deactivatedCourses.push({
        id: course.id,
        external_course_code: course.externalCourseCode,
      });
      incrementChange(fieldChanges, 'courses.active');
    }
  }

  const desiredSections = uniqueMap(
    desired.classSections,
    (section) => section.external_section_id,
    'class section external ID',
  );
  const baselineSections = uniqueMap(
    baseline.classSections,
    (section) => section.externalSectionId,
    'baseline class section external ID',
  );
  for (const section of desired.classSections) {
    const current = baselineSections.get(section.external_section_id);
    if (current === undefined) {
      sectionCounts.added += 1;
      continue;
    }
    if (current.externalCourseCode !== section.external_course_code) {
      throw new Error(
        `Class section ${section.external_section_id} cannot move between courses.`,
      );
    }
    const changed = [
      compareField(
        fieldChanges,
        'class_sections.department_code',
        current.departmentCode,
        section.department_code,
      ),
      compareField(
        fieldChanges,
        'class_sections.department_name',
        current.departmentName,
        section.department_name,
      ),
      compareField(
        fieldChanges,
        'class_sections.section_number',
        current.sectionNumber,
        section.section_number,
      ),
      compareArrayField(
        fieldChanges,
        'class_sections.instructors',
        current.instructors,
        section.instructors,
      ),
      compareField(
        fieldChanges,
        'class_sections.campus',
        current.campus,
        section.campus_name,
      ),
      compareField(
        fieldChanges,
        'class_sections.capacity',
        current.capacity,
        section.capacity,
      ),
      compareField(
        fieldChanges,
        'class_sections.schedule_text',
        current.scheduleText,
        section.schedule_text,
      ),
      compareField(
        fieldChanges,
        'class_sections.active',
        current.active,
        true,
      ),
    ].some(Boolean);
    sectionCounts[changed ? 'updated' : 'unchanged'] += 1;
  }
  for (const section of baseline.classSections) {
    if (section.active && !desiredSections.has(section.externalSectionId)) {
      sectionCounts.deactivated += 1;
      deactivatedSections.push({
        id: section.id,
        external_section_id: section.externalSectionId,
      });
      incrementChange(fieldChanges, 'class_sections.active');
    }
  }

  return {
    terms: termCounts,
    courses: courseCounts,
    class_sections: sectionCounts,
    field_changes: Object.fromEntries(
      Object.entries(fieldChanges).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    deactivated_courses: deactivatedCourses.sort((left, right) =>
      left.external_course_code.localeCompare(right.external_course_code),
    ),
    deactivated_class_sections: deactivatedSections.sort((left, right) =>
      left.external_section_id.localeCompare(right.external_section_id),
    ),
  };
}

export function hasCatalogChanges(diff: CatalogDiff): boolean {
  return [diff.terms, diff.courses, diff.class_sections].some(
    (counts) =>
      counts.added > 0 || counts.updated > 0 || counts.deactivated > 0,
  );
}

export function hashCatalogBaseline(baseline: CatalogBaseline): string {
  const canonical = JSON.stringify({
    term: baseline.term,
    courses: [...baseline.courses].sort((left, right) =>
      left.externalCourseCode.localeCompare(right.externalCourseCode),
    ),
    classSections: [...baseline.classSections].sort((left, right) =>
      left.externalSectionId.localeCompare(right.externalSectionId),
    ),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
