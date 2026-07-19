import { describe, expect, it } from 'vitest';
import { privateOperationSchema } from '../src/sync/private-operation.js';

const OPERATION_ID = '018f0000-0000-7000-8000-000000000001';
const ENTITY_ID = '018f0000-0000-7000-8000-000000000010';
const SECTION_ID = '018f0000-0000-7000-8000-000000000020';

function envelope(type: string, payload: Record<string, unknown>) {
  return {
    operation_id: OPERATION_ID,
    type,
    schema_version: 1,
    depends_on: [],
    payload,
  };
}

describe('private sync operation payloads', () => {
  it('canonicalizes a complete personal todo create payload', () => {
    const parsed = privateOperationSchema.parse(
      envelope('create_personal_todo', {
        personal_todo_id: ENTITY_ID,
        class_section_id: SECTION_ID,
        title: '  Read chapter 1 ',
        deadline: '2026-09-01T08:30:00+08:00',
        note: '  bring questions ',
        state: 'pending',
      }),
    );

    expect(parsed.payload).toEqual({
      personal_todo_id: ENTITY_ID,
      class_section_id: SECTION_ID,
      title: 'Read chapter 1',
      deadline: '2026-09-01T00:30:00.000Z',
      note: 'bring questions',
      state: 'pending',
    });
  });

  it('requires expected revisions for mutable singleton records', () => {
    expect(
      privateOperationSchema.parse(
        envelope('set_personal_task_state', {
          course_task_id: ENTITY_ID,
          state: 'completed',
          expected_revision: 0,
        }),
      ).payload,
    ).toMatchObject({ expected_revision: 0 });
    expect(() =>
      privateOperationSchema.parse(
        envelope('set_personal_task_state', {
          course_task_id: ENTITY_ID,
          state: 'completed',
        }),
      ),
    ).toThrow();
  });

  it('accepts explicit null private overlays without publishing them', () => {
    expect(
      privateOperationSchema.parse(
        envelope('upsert_personal_task_details', {
          course_task_id: ENTITY_ID,
          private_title: null,
          private_deadline: null,
          private_note: null,
          expected_revision: 0,
        }),
      ).payload,
    ).toEqual({
      course_task_id: ENTITY_ID,
      private_title: null,
      private_deadline: null,
      private_note: null,
      expected_revision: 0,
    });
  });

  it('rejects client-supplied ownership and invalid merge revisions', () => {
    expect(() =>
      privateOperationSchema.parse(
        envelope('create_personal_todo', {
          personal_todo_id: ENTITY_ID,
          class_section_id: null,
          title: 'Read',
          deadline: null,
          note: null,
          state: 'pending',
          user_id: ENTITY_ID,
        }),
      ),
    ).toThrow();
    expect(() =>
      privateOperationSchema.parse(
        envelope('merge_personal_todo_into_course_task', {
          personal_todo_id: ENTITY_ID,
          course_task_id: SECTION_ID,
          expected_personal_todo_revision: 0,
          expected_details_revision: 0,
          expected_state_revision: 0,
        }),
      ),
    ).toThrow();
  });
});
