import { z } from 'zod';

import { opaqueTokenSchema, uuidV7Schema } from '../schema.js';
import { syncEventSchema } from './event.js';
import { studentOperationTypeSchema } from './operation.js';
import {
  personalTaskDetailsRecordSchema,
  personalTaskStateRecordSchema,
  personalTodoRecordSchema,
  personalTodoTombstoneSchema,
} from './private-record.js';
import { taskCommentRecordSchema } from './public-record.js';
import {
  MAX_SYNC_OPERATIONS,
  MAX_SYNC_PAGE_SIZE,
  SYNC_PROTOCOL_VERSION,
} from './limits.js';

const messageSchema = z.string().min(1).max(500);
const nonnegativeRevisionSchema = z.number().int().nonnegative();
const emptyDetailsSchema = z.object({}).strict();

export const operationFollowUpSchema = z
  .object({
    type: z.literal('class_section_snapshot'),
    class_section_id: uuidV7Schema,
  })
  .strict();

const successResultSchema = z
  .object({
    operation_id: uuidV7Schema,
    operation_type: studentOperationTypeSchema,
    status: z.enum(['applied', 'replayed']),
    follow_up: operationFollowUpSchema.nullable(),
  })
  .strict();

export const revisionConflictDetailsSchema = z.discriminatedUnion(
  'entity_type',
  [
    z
      .object({
        entity_type: z.literal('personal_todo'),
        expected_revision: nonnegativeRevisionSchema,
        current_revision: nonnegativeRevisionSchema,
        current: z
          .union([personalTodoRecordSchema, personalTodoTombstoneSchema])
          .nullable(),
      })
      .strict(),
    z
      .object({
        entity_type: z.literal('personal_task_details'),
        expected_revision: nonnegativeRevisionSchema,
        current_revision: nonnegativeRevisionSchema,
        current: personalTaskDetailsRecordSchema.nullable(),
      })
      .strict(),
    z
      .object({
        entity_type: z.literal('personal_task_state'),
        expected_revision: nonnegativeRevisionSchema,
        current_revision: nonnegativeRevisionSchema,
        current: personalTaskStateRecordSchema.nullable(),
      })
      .strict(),
    z
      .object({
        entity_type: z.literal('task_comment'),
        expected_revision: nonnegativeRevisionSchema,
        current_revision: nonnegativeRevisionSchema,
        current: taskCommentRecordSchema.nullable(),
      })
      .strict(),
  ],
);

const revisionConflictErrorSchema = z
  .object({
    code: z.literal('revision_conflict'),
    details: revisionConflictDetailsSchema,
    message: messageSchema,
    retryable: z.literal(false),
  })
  .strict();

const duplicateProposalErrorSchema = z
  .object({
    code: z.literal('duplicate_proposal'),
    details: z
      .object({ existing_proposal_id: uuidV7Schema })
      .strict(),
    message: messageSchema,
    retryable: z.literal(false),
  })
  .strict();

const ordinaryOperationErrorSchema = z
  .object({
    code: z.enum([
      'conflict',
      'content_hidden',
      'inactive_term',
      'invalid_request',
      'not_found',
      'operation_id_reused',
    ]),
    details: emptyDetailsSchema,
    message: messageSchema,
    retryable: z.literal(false),
  })
  .strict();

export const rejectedOperationErrorSchema = z.union([
  revisionConflictErrorSchema,
  duplicateProposalErrorSchema,
  ordinaryOperationErrorSchema,
]);

const rejectedResultSchema = z
  .object({
    operation_id: uuidV7Schema,
    operation_type: studentOperationTypeSchema,
    status: z.literal('rejected'),
    error: rejectedOperationErrorSchema,
  })
  .strict();

export const dependencyFailedErrorSchema = z
  .object({
    code: z.literal('dependency_failed'),
    details: z
      .object({
        failed_operation_ids: z.array(uuidV7Schema).min(1).max(MAX_SYNC_OPERATIONS),
      })
      .strict(),
    message: messageSchema,
    retryable: z.literal(false),
  })
  .strict();

const dependencyFailedResultSchema = z
  .object({
    operation_id: uuidV7Schema,
    operation_type: studentOperationTypeSchema,
    status: z.literal('dependency_failed'),
    error: dependencyFailedErrorSchema,
  })
  .strict();

export const operationResultSchema = z.discriminatedUnion('status', [
  successResultSchema,
  rejectedResultSchema,
  dependencyFailedResultSchema,
]);

export const incrementalSyncResponseSchema = z
  .object({
    protocol_version: z.literal(SYNC_PROTOCOL_VERSION),
    mode: z.literal('incremental'),
    request_id: uuidV7Schema,
    operation_results: z
      .array(operationResultSchema)
      .max(MAX_SYNC_OPERATIONS),
    events: z.array(syncEventSchema).max(MAX_SYNC_PAGE_SIZE),
    next_cursor: opaqueTokenSchema,
    has_more: z.boolean(),
  })
  .strict();

export type OperationResult = z.infer<typeof operationResultSchema>;
export type RejectedOperationError = z.infer<
  typeof rejectedOperationErrorSchema
>;
export type DependencyFailedError = z.infer<
  typeof dependencyFailedErrorSchema
>;
export type RevisionConflictDetails = z.infer<
  typeof revisionConflictDetailsSchema
>;
export type IncrementalSyncResponse = z.infer<
  typeof incrementalSyncResponseSchema
>;
