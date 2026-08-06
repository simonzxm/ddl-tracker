import type { Client } from 'pg';

import type {
  BaselineClassSection,
  BaselineCourse,
  BaselineTerm,
  CatalogBaseline,
} from './catalog-diff.js';

interface TermRow {
  id: string;
  name: string;
}

interface CourseRow {
  id: string;
  external_course_code: string;
  name: string;
  credits: string | null;
  active: boolean;
  revision: number;
}

interface SectionRow {
  id: string;
  external_section_id: string;
  external_course_code: string;
  section_number: string;
  department_code: string | null;
  department_name: string | null;
  instructors: string[];
  campus: string | null;
  capacity: number | null;
  schedule_text: string | null;
  active: boolean;
  revision: number;
}

export async function loadCatalogBaseline(
  client: Client,
  externalTermCode: string,
): Promise<CatalogBaseline> {
  const termResult = await client.query<TermRow>(
    `select id, name
     from academic_terms
     where external_term_code = $1
     limit 1`,
    [externalTermCode],
  );
  const termRow = termResult.rows[0];
  const term: BaselineTerm | null =
    termRow === undefined
      ? null
      : {
          id: termRow.id,
          name: termRow.name,
        };
  if (term === null) {
    return { term: null, courses: [], classSections: [] };
  }

  const courseResult = await client.query<CourseRow>(
    `select id, external_course_code, name, credits::text, active, revision
     from courses
     where term_id = $1
     order by external_course_code`,
    [term.id],
  );
  const courses: BaselineCourse[] = courseResult.rows.map((course) => ({
    id: course.id,
    externalCourseCode: course.external_course_code,
    name: course.name,
    credits: course.credits,
    active: course.active,
    revision: course.revision,
  }));

  const sectionResult = await client.query<SectionRow>(
    `select s.id, s.external_section_id, c.external_course_code,
            s.section_number, s.department_code, s.department_name,
            s.instructors, s.campus, s.capacity,
            s.schedule_text, s.active, s.revision
     from class_sections s
     join courses c on c.id = s.course_id
     where c.term_id = $1
     order by s.external_section_id`,
    [term.id],
  );
  const classSections: BaselineClassSection[] = sectionResult.rows.map(
    (section) => ({
      id: section.id,
      externalSectionId: section.external_section_id,
      externalCourseCode: section.external_course_code,
      sectionNumber: section.section_number,
      departmentCode: section.department_code,
      departmentName: section.department_name,
      instructors: section.instructors,
      campus: section.campus,
      capacity: section.capacity,
      scheduleText: section.schedule_text,
      active: section.active,
      revision: section.revision,
    }),
  );
  return { term, courses, classSections };
}
