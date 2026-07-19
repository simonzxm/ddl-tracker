import type { Client } from 'pg';

import type {
  BaselineClassSection,
  BaselineCourse,
  BaselineTerm,
  CatalogBaseline,
} from './import-diff.js';

interface TermRow {
  id: string;
  external_term_code: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
}

interface CourseRow {
  id: string;
  external_course_code: string;
  name: string;
  credits: string | null;
  department: string | null;
  active: boolean;
  revision: number;
}

interface SectionRow {
  id: string;
  external_section_id: string;
  external_course_code: string;
  section_number: string;
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
    `select id, external_term_code, name, starts_on::text, ends_on::text
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
          externalCode: termRow.external_term_code,
          name: termRow.name,
          startsOn: termRow.starts_on,
          endsOn: termRow.ends_on,
        };
  if (term === null) {
    return { term: null, courses: [], classSections: [] };
  }

  const courseResult = await client.query<CourseRow>(
    `select id, external_course_code, name, credits::text, department,
            active, revision
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
    department: course.department,
    active: course.active,
    revision: course.revision,
  }));

  const sectionResult = await client.query<SectionRow>(
    `select s.id, s.external_section_id, c.external_course_code,
            s.section_number, s.instructors, s.campus, s.capacity,
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
