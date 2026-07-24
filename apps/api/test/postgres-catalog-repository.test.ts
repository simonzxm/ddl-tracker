import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresCatalogRepository } from '../src/catalog/postgres-catalog-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const TERM_ID = '018f0000-0000-7000-8000-000000000301';
const OTHER_TERM_ID = '018f0000-0000-7000-8000-000000000302';
const COURSE_ID = '018f0000-0000-7000-8000-000000000303';
const OTHER_COURSE_ID = '018f0000-0000-7000-8000-000000000304';

describePostgres('PostgresCatalogRepository', () => {
  let client: Client;
  let repository: PostgresCatalogRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresCatalogRepository(client);
  });

  beforeEach(async () => {
    await client.query(
      'truncate table class_sections, courses, academic_terms cascade',
    );
    await client.query(
      `insert into academic_terms (
         id, external_term_code, name, starts_on, ends_on
       ) values
         ($1, '2026-2027-1', 'Current', '2026-08-31', '2027-01-17'),
         ($2, '2025-2026-2', 'Older', '2026-02-01', '2026-06-30')`,
      [TERM_ID, OTHER_TERM_ID],
    );
    await client.query(
      `insert into courses (
         id, term_id, external_course_code, name, credits, department
       ) values
         ($1, $2, '0010', 'Course A', 3.50, 'Department'),
         ($3, $4, '0001', 'Other Course', null, null)`,
      [COURSE_ID, TERM_ID, OTHER_COURSE_ID, OTHER_TERM_ID],
    );
    await client.query(
      `insert into class_sections (
         id, course_id, external_section_id, section_number, instructors,
         department_code, department_name, campus, capacity, schedule_text,
         raw_source, active, revision
       ) values
         ($1, $2, 'section-a', '02', '["Teacher"]'::jsonb,
          '001', 'Department', 'Campus', 30, 'Thursday',
          '{"secret":"raw"}'::jsonb, true, 2),
         ($3, $4, 'section-b', '01', '[]'::jsonb,
          null, null, null, null, null, '{"other":true}'::jsonb, true, 1)`,
      [
        '018f0000-0000-7000-8000-000000000305',
        COURSE_ID,
        '018f0000-0000-7000-8000-000000000306',
        OTHER_COURSE_ID,
      ],
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it('orders terms by start date and maps date values to local date strings', async () => {
    await expect(repository.listTerms()).resolves.toEqual([
      {
        id: TERM_ID,
        externalCode: '2026-2027-1',
        name: 'Current',
        startsOn: '2026-08-31',
        endsOn: '2027-01-17',
        statusOverride: null,
      },
      {
        id: OTHER_TERM_ID,
        externalCode: '2025-2026-2',
        name: 'Older',
        startsOn: '2026-02-01',
        endsOn: '2026-06-30',
        statusOverride: null,
      },
    ]);
  });

  it('filters courses by the requested term and preserves codes and decimals', async () => {
    await expect(repository.listCourses(TERM_ID)).resolves.toEqual([
      {
        id: COURSE_ID,
        externalCourseCode: '0010',
        name: 'Course A',
        credits: '3.50',
      },
    ]);
  });

  it('filters sections by course without returning raw source payloads', async () => {
    const sections = await repository.listClassSections(COURSE_ID);

    expect(sections).toEqual([
      {
        id: '018f0000-0000-7000-8000-000000000305',
        externalSectionId: 'section-a',
        sectionNumber: '02',
        departmentCode: '001',
        departmentName: 'Department',
        instructors: ['Teacher'],
        campus: 'Campus',
        capacity: 30,
        scheduleText: 'Thursday',
        active: true,
        revision: 2,
      },
    ]);
    expect(JSON.stringify(sections)).not.toContain('secret');
  });
});
