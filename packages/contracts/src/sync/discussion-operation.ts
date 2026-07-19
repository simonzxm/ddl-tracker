import { z } from 'zod';

import {
  normalizedTextSchema,
  nullableNormalizedTextSchema,
  uuidV7Schema,
} from '../schema.js';
import { MAX_SYNC_OPERATIONS } from './limits.js';

const envelope = {
  operation_id: uuidV7Schema,
  schema_version: z.literal(1),
  depends_on: z.array(uuidV7Schema).max(MAX_SYNC_OPERATIONS),
};
const existingRevisionSchema = z.number().int().min(1);

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

const createTaskCommentSchema = operation(
  'create_task_comment',
  z
    .object({
      comment_id: uuidV7Schema,
      course_task_id: uuidV7Schema,
      body: normalizedTextSchema(1, 2000),
    })
    .strict(),
);

const editTaskCommentSchema = operation(
  'edit_task_comment',
  z
    .object({
      comment_id: uuidV7Schema,
      body: normalizedTextSchema(1, 2000),
      expected_revision: existingRevisionSchema,
    })
    .strict(),
);

const deleteTaskCommentSchema = operation(
  'delete_task_comment',
  z
    .object({
      comment_id: uuidV7Schema,
      expected_revision: existingRevisionSchema,
    })
    .strict(),
);

export const reportTargetTypeSchema = z.enum([
  'course_task',
  'proposal',
  'comment',
  'user',
]);
export const reportReasonSchema = z.enum([
  'inaccurate',
  'spam',
  'abuse',
  'privacy',
  'other',
]);

const createContentReportSchema = operation(
  'create_content_report',
  z
    .object({
      report_id: uuidV7Schema,
      target_type: reportTargetTypeSchema,
      target_id: uuidV7Schema,
      reason: reportReasonSchema,
      details: nullableNormalizedTextSchema(1000),
    })
    .strict(),
);

export const discussionOperationSchema = z.discriminatedUnion('type', [
  createTaskCommentSchema,
  editTaskCommentSchema,
  deleteTaskCommentSchema,
  createContentReportSchema,
]);

export type DiscussionOperation = z.infer<typeof discussionOperationSchema>;
