import { z } from 'zod';

import { contributionOperationSchema } from './contribution-operation.js';
import { discussionOperationSchema } from './discussion-operation.js';
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

export const operationEnvelopeSchema = z
  .union([
    privateOperationSchema,
    contributionOperationSchema,
    discussionOperationSchema,
  ])
  .superRefine((operation, context) => {
    for (const [field, value] of Object.entries(operation.payload)) {
      if (field.endsWith('_id') && value === operation.operation_id) {
        context.addIssue({
          code: 'custom',
          path: ['payload', field],
          message: 'An operation ID cannot also be used as an entity ID.',
        });
      }
    }
  });

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
