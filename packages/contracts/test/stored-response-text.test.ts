import { describe, expect, it } from 'vitest';

import {
  classSectionRecordSchema,
  classSectionSchema,
  courseSchema,
  discussionOperationSchema,
  operationResultSchema,
  personalTaskDetailsRecordSchema,
  personalTodoRecordSchema,
  privateOperationSchema,
  profileUpdateRequestSchema,
  publicUserProfileRecordSchema,
  publicUserSchema,
  sessionSchema,
  taskCommentRecordSchema,
  taskMergeRecordSchema,
  taskProposalRecordSchema,
  termSchema,
} from '../src/index.js';

const ID = '018f0000-0000-7000-8000-000000000001';
const OTHER_ID = '018f0000-0000-7000-8000-000000000002';
const THIRD_ID = '018f0000-0000-7000-8000-000000000003';
const NOW = '2026-08-05T07:00:00.000Z';
const LONG = 'X'.repeat(10_001);
const HASH = 'a'.repeat(64);

describe('storage-backed response text', () => {
  it('preserves unconstrained user, session, and catalog columns', () => {
    expect(
      publicUserSchema.parse({
        id: ID,
        username: '',
        display_name: LONG,
        avatar_url: 'historical-not-a-url',
        bio: LONG,
        status: 'active',
        profile_revision: 1,
      }),
    ).toMatchObject({ username: '', display_name: LONG, bio: LONG });

    expect(
      sessionSchema.parse({
        id: ID,
        device_name: LONG,
        device_metadata: {},
        created_at: NOW,
        last_seen_at: NOW,
        idle_expires_at: NOW,
        absolute_expires_at: NOW,
        revoked_at: null,
      }).device_name,
    ).toBe(LONG);

    expect(
      termSchema.parse({
        id: ID,
        external_code: '',
        name: LONG,
        starts_on: null,
        ends_on: null,
        status: 'archived',
      }),
    ).toMatchObject({ external_code: '', name: LONG });

    expect(
      courseSchema.parse({
        id: ID,
        external_course_code: LONG,
        name: '',
        credits: '3.00',
      }),
    ).toMatchObject({ external_course_code: LONG, name: '' });

    const instructors = Array.from({ length: 101 }, (_, index) =>
      index === 0 ? LONG : `Teacher ${String(index)}`,
    );
    expect(
      classSectionSchema.parse({
        id: ID,
        external_section_id: '',
        section_number: LONG,
        department_code: LONG,
        department_name: '',
        instructors,
        campus: LONG,
        capacity: null,
        schedule_text: LONG,
        active: true,
        revision: 1,
      }).instructors,
    ).toEqual(instructors);
  });

  it('preserves unconstrained public and private sync record text', () => {
    expect(
      classSectionRecordSchema.parse({
        id: ID,
        course_id: OTHER_ID,
        external_section_id: '',
        section_number: LONG,
        department_code: LONG,
        department_name: '',
        instructors: [LONG],
        campus: LONG,
        capacity: null,
        schedule_text: LONG,
        active: true,
        revision: 1,
        created_at: NOW,
        updated_at: NOW,
      }).schedule_text,
    ).toBe(LONG);

    expect(
      taskProposalRecordSchema.parse({
        id: ID,
        course_task_id: OTHER_ID,
        author_id: THIRD_ID,
        title: '',
        deadline: NOW,
        description: LONG,
        evidence_note: LONG,
        evidence_url: 'historical-not-a-url',
        content_fingerprint: HASH,
        state: 'visible',
        revision: 1,
        created_at: NOW,
      }),
    ).toMatchObject({ title: '', description: LONG });

    expect(
      publicUserProfileRecordSchema.parse({
        id: ID,
        username: '',
        display_name: LONG,
        avatar_url: 'historical-not-a-url',
        bio: LONG,
        status: 'active',
        revision: 1,
        created_at: NOW,
        updated_at: NOW,
      }).display_name,
    ).toBe(LONG);

    expect(
      taskMergeRecordSchema.parse({
        source_task_id: ID,
        target_task_id: OTHER_ID,
        reason: '',
        revision: 1,
        created_at: NOW,
      }).reason,
    ).toBe('');

    expect(
      taskCommentRecordSchema.parse({
        id: ID,
        course_task_id: OTHER_ID,
        author_id: THIRD_ID,
        body: LONG,
        revision: 1,
        state: 'visible',
        deleted_at: null,
        created_at: NOW,
        updated_at: NOW,
      }).body,
    ).toBe(LONG);

    expect(
      personalTodoRecordSchema.parse({
        id: ID,
        class_section_id: null,
        title: '',
        deadline: null,
        note: LONG,
        state: 'pending',
        revision: 1,
        deleted_at: null,
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ title: '', note: LONG });

    expect(
      personalTaskDetailsRecordSchema.parse({
        course_task_id: ID,
        private_title: LONG,
        private_deadline: null,
        private_note: '',
        revision: 1,
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ private_title: LONG, private_note: '' });
  });

  it('preserves storage-backed operation receipt text', () => {
    expect(
      operationResultSchema.parse({
        operation_id: ID,
        operation_type: 'create_task_comment',
        status: 'rejected',
        error: {
          code: 'not_found',
          details: {},
          message: LONG,
          retryable: false,
        },
      }).status,
    ).toBe('rejected');
  });

  it('keeps current mutation request limits separate', () => {
    expect(() =>
      profileUpdateRequestSchema.parse({
        username: 'student_1',
        display_name: LONG,
        avatar_url: null,
        bio: null,
        expected_revision: 1,
      }),
    ).toThrow();

    expect(() =>
      privateOperationSchema.parse({
        operation_id: ID,
        schema_version: 1,
        depends_on: [],
        type: 'create_personal_todo',
        payload: {
          personal_todo_id: OTHER_ID,
          class_section_id: null,
          title: '',
          deadline: null,
          note: LONG,
          state: 'pending',
        },
      }),
    ).toThrow();

    expect(() =>
      discussionOperationSchema.parse({
        operation_id: ID,
        schema_version: 1,
        depends_on: [],
        type: 'create_task_comment',
        payload: {
          comment_id: OTHER_ID,
          course_task_id: THIRD_ID,
          body: LONG,
        },
      }),
    ).toThrow();
  });
});
