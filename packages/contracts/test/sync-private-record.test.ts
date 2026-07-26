import { describe, expect, it } from 'vitest';

import {
  followedClassSectionRecordSchema,
  personalTaskDetailsRecordSchema,
  personalTaskDetailsTombstoneSchema,
  personalTaskStateRecordSchema,
  personalTaskStateTombstoneSchema,
  personalTodoRecordSchema,
  personalTodoTombstoneSchema,
} from '../src/sync/private-record.js';

const SECTION_ID = '018f0000-0000-7000-8000-000000000001';
const TASK_ID = '018f0000-0000-7000-8000-000000000002';
const TODO_ID = '018f0000-0000-7000-8000-000000000003';
const NOW = '2026-09-01T00:30:00Z';

describe('private sync records', () => {
  it('parses followed sections and personal todos', () => {
    expect(
      followedClassSectionRecordSchema.parse({
        class_section_id: SECTION_ID,
        followed_at: NOW,
      }),
    ).toMatchObject({ class_section_id: SECTION_ID });

    expect(
      personalTodoRecordSchema.parse({
        id: TODO_ID,
        class_section_id: SECTION_ID,
        title: 'Read chapter 3',
        deadline: null,
        note: null,
        state: 'pending',
        revision: 1,
        deleted_at: null,
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ id: TODO_ID, state: 'pending' });
  });

  it('parses task details and state records', () => {
    expect(
      personalTaskDetailsRecordSchema.parse({
        course_task_id: TASK_ID,
        private_title: 'My title',
        private_deadline: null,
        private_note: 'Only visible to me',
        revision: 2,
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ course_task_id: TASK_ID, revision: 2 });

    expect(
      personalTaskStateRecordSchema.parse({
        course_task_id: TASK_ID,
        state: 'completed',
        revision: 3,
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ state: 'completed' });
  });

  it('uses explicit private tombstones', () => {
    expect(
      personalTodoTombstoneSchema.parse({
        id: TODO_ID,
        revision: 2,
        deleted_at: NOW,
      }),
    ).toMatchObject({ id: TODO_ID, revision: 2 });

    expect(
      personalTaskDetailsTombstoneSchema.parse({
        course_task_id: TASK_ID,
        revision: 3,
        deleted_at: NOW,
      }),
    ).toMatchObject({ course_task_id: TASK_ID });

    expect(
      personalTaskStateTombstoneSchema.parse({
        course_task_id: TASK_ID,
        revision: 4,
        deleted_at: NOW,
      }),
    ).toMatchObject({ course_task_id: TASK_ID });
  });
});
