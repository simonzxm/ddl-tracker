import type { Client } from 'pg';

import type {
  CatalogRepository,
  ClassSectionRecord,
  CourseRecord,
  TermRecord,
} from './catalog-service.js';

interface TermRow {
  id: string;
  external_term_code: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  status_override: 'active' | 'archived' | null;
}

interface CourseRow {
  id: string;
  external_course_code: string;
  name: string;
  credits: string | null;
}

interface SectionRow {
  id: string;
  external_section_id: string;
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

export class PostgresCatalogRepository implements CatalogRepository {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async listTerms(): Promise<TermRecord[]> {
    const result = await this.#client.query<TermRow>(
      `select id, external_term_code, name, starts_on::text, ends_on::text,
              status_override
       from academic_terms
       order by starts_on desc nulls last, external_term_code, id`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      externalCode: row.external_term_code,
      name: row.name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      statusOverride: row.status_override,
    }));
  }

  async listCourses(termId: string): Promise<CourseRecord[]> {
    const result = await this.#client.query<CourseRow>(
      `select id, external_course_code, name, credits::text
       from courses
       where term_id = $1
       order by external_course_code, id`,
      [termId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      externalCourseCode: row.external_course_code,
      name: row.name,
      credits: row.credits,
    }));
  }

  async listClassSections(courseId: string): Promise<ClassSectionRecord[]> {
    const result = await this.#client.query<SectionRow>(
      `select id, external_section_id, section_number, department_code,
              department_name, instructors, campus, capacity, schedule_text,
              active, revision
       from class_sections
       where course_id = $1
       order by section_number, external_section_id, id`,
      [courseId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      externalSectionId: row.external_section_id,
      sectionNumber: row.section_number,
      departmentCode: row.department_code,
      departmentName: row.department_name,
      instructors: row.instructors,
      campus: row.campus,
      capacity: row.capacity,
      scheduleText: row.schedule_text,
      active: row.active,
      revision: row.revision,
    }));
  }
}
