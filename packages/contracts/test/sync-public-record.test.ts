import { describe, expect, it } from 'vitest';

import {
  classSectionRecordSchema,
  courseTaskRecordSchema,
  taskProposalRecordSchema,
} from '../src/sync/public-record.js';

const USER_ID = '018f0000-0000-7000-8000-000000000001';
const SECTION_ID = '018f0000-0000-7000-8000-000000000002';
const COURSE_ID = '018f0000-0000-7000-8000-000000000003';
const TASK_ID = '018f0000-0000-7000-8000-000000000004';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000000005';
const CREATED_AT = '2026-09-01T00:30:00Z';

describe('public sync records', () => {
  it('parses complete class section records', () => {
    expect(
      classSectionRecordSchema.parse({
        id: SECTION_ID,
        course_id: COURSE_ID,
        external_section_id: '2026-001',
        section_number: '01',
        department_code: 'CS',
        department_name: 'Computer Science',
        instructors: ['Ada Lovelace'],
        campus: 'Xianlin',
        capacity: 120,
        schedule_text: 'Monday 08:00',
        active: true,
        revision: 2,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      }),
    ).toMatchObject({ id: SECTION_ID, revision: 2 });
  });

  it('parses complete course task and proposal records', () => {
    expect(
      courseTaskRecordSchema.parse({
        id: TASK_ID,
        class_section_id: SECTION_ID,
        created_by: USER_ID,
        state: 'visible',
        revision: 1,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      }),
    ).toMatchObject({ id: TASK_ID, state: 'visible' });

    expect(
      taskProposalRecordSchema.parse({
        id: PROPOSAL_ID,
        course_task_id: TASK_ID,
        author_id: USER_ID,
        title: 'Project report',
        deadline: '2026-09-02T08:00:00+08:00',
        description: null,
        evidence_note: null,
        evidence_url: null,
        content_fingerprint: 'a'.repeat(64),
        state: 'visible',
        revision: 1,
        created_at: CREATED_AT,
      }),
    ).toMatchObject({
      id: PROPOSAL_ID,
      deadline: '2026-09-02T00:00:00.000Z',
    });
  });

  it('rejects incomplete records and unknown fields', () => {
    expect(() =>
      courseTaskRecordSchema.parse({
        id: TASK_ID,
        class_section_id: SECTION_ID,
        state: 'visible',
        revision: 1,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      }),
    ).toThrow();

    expect(() =>
      classSectionRecordSchema.parse({
        id: SECTION_ID,
        course_id: COURSE_ID,
        external_section_id: '2026-001',
        section_number: '01',
        department_code: null,
        department_name: null,
        instructors: [],
        campus: null,
        capacity: null,
        schedule_text: null,
        active: true,
        revision: 1,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
        database_row_version: 10,
      }),
    ).toThrow();
  });
});
