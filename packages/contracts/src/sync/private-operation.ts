import { z } from 'zod';

import {
  normalizedTextSchema,
  nullableNormalizedTextSchema,
  rfc3339TimestampSchema,
  uuidV7Schema,
} from '../schema.js';
import { MAX_SYNC_OPERATIONS } from './limits.js';

export const personalTaskStateSchema = z.enum([
  'pending',
  'completed',
  'ignored',
]);

const revisionSchema = z.number().int().min(0);
const existingRevisionSchema = z.number().int().min(1);
const envelope = {
  operation_id: uuidV7Schema,
  schema_version: z.literal(1),
  depends_on: z.array(uuidV7Schema).max(MAX_SYNC_OPERATIONS),
};

function operation<const Type extends string, Payload extends z.ZodType>(
  type: Type,
  payload: Payload,
) {
  return z
    .object({
      ...envelope,
      type: z.literal(type),
      payload,
    })
    .strict();
}

const followClassSectionSchema = operation(
  'follow_class_section',
  z.object({ class_section_id: uuidV7Schema }).strict(),
);
const unfollowClassSectionSchema = operation(
  'unfollow_class_section',
  z.object({ class_section_id: uuidV7Schema }).strict(),
);

const personalTodoFields = {
  personal_todo_id: uuidV7Schema,
  class_section_id: uuidV7Schema.nullable(),
  title: normalizedTextSchema(1, 200),
  deadline: rfc3339TimestampSchema.nullable(),
  note: nullableNormalizedTextSchema(2000),
  state: personalTaskStateSchema,
};

const createPersonalTodoSchema = operation(
  'create_personal_todo',
  z.object(personalTodoFields).strict(),
);
const updatePersonalTodoSchema = operation(
  'update_personal_todo',
  z
    .object({
      ...personalTodoFields,
      expected_revision: existingRevisionSchema,
    })
    .strict(),
);
const deletePersonalTodoSchema = operation(
  'delete_personal_todo',
  z
    .object({
      personal_todo_id: uuidV7Schema,
      expected_revision: existingRevisionSchema,
    })
    .strict(),
);

const upsertPersonalTaskDetailsSchema = operation(
  'upsert_personal_task_details',
  z
    .object({
      course_task_id: uuidV7Schema,
      private_title: nullableNormalizedTextSchema(200),
      private_deadline: rfc3339TimestampSchema.nullable(),
      private_note: nullableNormalizedTextSchema(2000),
      expected_revision: revisionSchema,
    })
    .strict(),
);
const deletePersonalTaskDetailsSchema = operation(
  'delete_personal_task_details',
  z
    .object({
      course_task_id: uuidV7Schema,
      expected_revision: existingRevisionSchema,
    })
    .strict(),
);
const setPersonalTaskStateSchema = operation(
  'set_personal_task_state',
  z
    .object({
      course_task_id: uuidV7Schema,
      state: personalTaskStateSchema,
      expected_revision: revisionSchema,
    })
    .strict(),
);
const mergePersonalTodoSchema = operation(
  'merge_personal_todo_into_course_task',
  z
    .object({
      personal_todo_id: uuidV7Schema,
      course_task_id: uuidV7Schema,
      expected_personal_todo_revision: existingRevisionSchema,
      expected_details_revision: revisionSchema,
      expected_state_revision: revisionSchema,
    })
    .strict(),
);

export const privateOperationSchema = z.discriminatedUnion('type', [
  followClassSectionSchema,
  unfollowClassSectionSchema,
  createPersonalTodoSchema,
  updatePersonalTodoSchema,
  deletePersonalTodoSchema,
  upsertPersonalTaskDetailsSchema,
  deletePersonalTaskDetailsSchema,
  setPersonalTaskStateSchema,
  mergePersonalTodoSchema,
]);

export const privateOperationTypeSchema = z.enum([
  'follow_class_section',
  'unfollow_class_section',
  'create_personal_todo',
  'update_personal_todo',
  'delete_personal_todo',
  'upsert_personal_task_details',
  'delete_personal_task_details',
  'set_personal_task_state',
  'merge_personal_todo_into_course_task',
]);

export type PrivateOperation = z.infer<typeof privateOperationSchema>;
