import { z } from 'zod';

import { uuidV7Schema } from '../schema.js';
import { contributionOperationSchema } from './contribution-operation.js';
import { MAX_SYNC_OPERATIONS } from './limits.js';
import { privateOperationSchema } from './private-operation.js';

export const studentOperationTypeSchema = z.enum([
  'follow_class_section',
  'unfollow_class_section',
  'create_personal_todo',
  'update_personal_todo',
  'delete_personal_todo',
  'upsert_personal_task_details',
  'delete_personal_task_details',
  'set_personal_task_state',
  'merge_personal_todo_into_course_task',
  'publish_personal_todo_as_course_task',
  'publish_personal_task_details_as_proposal',
  'create_course_task_with_initial_proposal',
  'create_task_proposal',
  'set_accuracy_vote',
  'create_task_comment',
  'edit_task_comment',
  'delete_task_comment',
  'create_content_report',
]);

export const publicOperationTypeSchema = z.enum([
  'create_task_comment',
  'edit_task_comment',
  'delete_task_comment',
  'create_content_report',
]);

const publicOperationEnvelopeSchema = z
  .object({
    operation_id: uuidV7Schema,
    type: publicOperationTypeSchema,
    schema_version: z.literal(1),
    depends_on: z.array(uuidV7Schema).max(MAX_SYNC_OPERATIONS),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const operationEnvelopeSchema = z.union([
  privateOperationSchema,
  contributionOperationSchema,
  publicOperationEnvelopeSchema,
]);

export const operationBatchSchema = z
  .array(operationEnvelopeSchema)
  .max(MAX_SYNC_OPERATIONS)
  .superRefine((operations, context) => {
    const seenOperationIds = new Set<string>();

    operations.forEach((operation, operationIndex) => {
      if (seenOperationIds.has(operation.operation_id)) {
        context.addIssue({
          code: 'custom',
          path: [operationIndex, 'operation_id'],
          message: 'Operation IDs must be unique within a batch.',
        });
      }

      const uniqueDependencies = new Set(operation.depends_on);
      if (uniqueDependencies.size !== operation.depends_on.length) {
        context.addIssue({
          code: 'custom',
          path: [operationIndex, 'depends_on'],
          message: 'Dependency IDs must not repeat.',
        });
      }

      operation.depends_on.forEach((dependencyId, dependencyIndex) => {
        if (!seenOperationIds.has(dependencyId)) {
          context.addIssue({
            code: 'custom',
            path: [operationIndex, 'depends_on', dependencyIndex],
            message: 'Dependencies must reference an earlier operation.',
          });
        }
      });

      seenOperationIds.add(operation.operation_id);
    });
  });

export type StudentOperationType = z.infer<typeof studentOperationTypeSchema>;
export type OperationEnvelope = z.infer<typeof operationEnvelopeSchema>;
