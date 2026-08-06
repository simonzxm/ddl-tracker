import { z } from 'zod';

import {
  normalizedTextSchema,
  nullableNormalizedTextSchema,
  rfc3339TimestampSchema,
  storedTextSchema,
  uuidV7Schema,
} from '../schema.js';
import {
  reportReasonSchema,
  reportTargetTypeSchema,
} from './discussion-operation.js';
import { personalTaskStateSchema } from './private-operation.js';

const revisionSchema = z.number().int().positive();

export const followedClassSectionRecordSchema = z
  .object({
    class_section_id: uuidV7Schema,
    followed_at: rfc3339TimestampSchema,
  })
  .strict();

export const personalTodoRecordSchema = z
  .object({
    id: uuidV7Schema,
    class_section_id: uuidV7Schema.nullable(),
    title: normalizedTextSchema(1, 200),
    deadline: rfc3339TimestampSchema.nullable(),
    note: nullableNormalizedTextSchema(2000),
    state: personalTaskStateSchema,
    revision: revisionSchema,
    deleted_at: z.null(),
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const personalTodoTombstoneSchema = z
  .object({
    id: uuidV7Schema,
    revision: revisionSchema,
    deleted_at: rfc3339TimestampSchema,
  })
  .strict();

export const personalTaskDetailsRecordSchema = z
  .object({
    course_task_id: uuidV7Schema,
    private_title: nullableNormalizedTextSchema(200),
    private_deadline: rfc3339TimestampSchema.nullable(),
    private_note: nullableNormalizedTextSchema(2000),
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const personalTaskDetailsTombstoneSchema = z
  .object({
    course_task_id: uuidV7Schema,
    revision: revisionSchema,
    deleted_at: rfc3339TimestampSchema,
  })
  .strict();

export const personalTaskStateRecordSchema = z
  .object({
    course_task_id: uuidV7Schema,
    state: personalTaskStateSchema,
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const personalTaskStateTombstoneSchema = z
  .object({
    course_task_id: uuidV7Schema,
    revision: revisionSchema,
    deleted_at: rfc3339TimestampSchema,
  })
  .strict();

const reporterContentReportIdentity = {
  report_id: uuidV7Schema,
  target_type: reportTargetTypeSchema,
  target_id: uuidV7Schema,
  reason: reportReasonSchema,
  details: storedTextSchema.nullable(),
  created_at: rfc3339TimestampSchema,
};

export const reporterContentReportRecordSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...reporterContentReportIdentity,
      status: z.literal('open'),
      resolution: z.null(),
      resolved_at: z.null(),
    })
    .strict(),
  z
    .object({
      ...reporterContentReportIdentity,
      status: z.literal('resolved'),
      resolution: storedTextSchema,
      resolved_at: rfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      ...reporterContentReportIdentity,
      status: z.literal('dismissed'),
      resolution: storedTextSchema,
      resolved_at: rfc3339TimestampSchema,
    })
    .strict(),
]);

export type FollowedClassSectionRecord = z.infer<
  typeof followedClassSectionRecordSchema
>;
export type PersonalTodoRecord = z.infer<typeof personalTodoRecordSchema>;
export type PersonalTodoTombstone = z.infer<
  typeof personalTodoTombstoneSchema
>;
export type PersonalTaskDetailsRecord = z.infer<
  typeof personalTaskDetailsRecordSchema
>;
export type PersonalTaskDetailsTombstone = z.infer<
  typeof personalTaskDetailsTombstoneSchema
>;
export type PersonalTaskStateRecord = z.infer<
  typeof personalTaskStateRecordSchema
>;
export type PersonalTaskStateTombstone = z.infer<
  typeof personalTaskStateTombstoneSchema
>;
export type ReporterContentReportRecord = z.infer<
  typeof reporterContentReportRecordSchema
>;
