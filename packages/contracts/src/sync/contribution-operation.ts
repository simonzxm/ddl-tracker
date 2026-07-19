import { z } from 'zod';

import { canonicalizeProposal } from '../proposal.js';
import { uuidV7Schema } from '../schema.js';
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

export const canonicalProposalPayloadSchema = z
  .object({
    title: z.string(),
    deadline: z.string(),
    description: z.string().nullable(),
    evidence_note: z.string().nullable(),
    evidence_url: z.string().nullable(),
  })
  .strict()
  .transform((value, context) => {
    try {
      return canonicalizeProposal(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid proposal.',
      });
      return z.NEVER;
    }
  });

const publishPersonalTodoSchema = operation(
  'publish_personal_todo_as_course_task',
  z
    .object({
      personal_todo_id: uuidV7Schema,
      expected_personal_todo_revision: existingRevisionSchema,
      course_task_id: uuidV7Schema,
      class_section_id: uuidV7Schema,
      proposal_id: uuidV7Schema,
      proposal: canonicalProposalPayloadSchema,
    })
    .strict(),
);

const publishPersonalDetailsSchema = operation(
  'publish_personal_task_details_as_proposal',
  z
    .object({
      course_task_id: uuidV7Schema,
      proposal_id: uuidV7Schema,
      expected_details_revision: existingRevisionSchema,
      proposal: canonicalProposalPayloadSchema,
    })
    .strict(),
);

const createCourseTaskSchema = operation(
  'create_course_task_with_initial_proposal',
  z
    .object({
      course_task_id: uuidV7Schema,
      class_section_id: uuidV7Schema,
      proposal_id: uuidV7Schema,
      proposal: canonicalProposalPayloadSchema,
    })
    .strict(),
);

const createTaskProposalSchema = operation(
  'create_task_proposal',
  z
    .object({
      course_task_id: uuidV7Schema,
      proposal_id: uuidV7Schema,
      proposal: canonicalProposalPayloadSchema,
    })
    .strict(),
);

const setAccuracyVoteSchema = operation(
  'set_accuracy_vote',
  z
    .object({
      proposal_id: uuidV7Schema,
      value: z.enum(['up', 'down', 'none']),
    })
    .strict(),
);

export const contributionOperationSchema = z.discriminatedUnion('type', [
  publishPersonalTodoSchema,
  publishPersonalDetailsSchema,
  createCourseTaskSchema,
  createTaskProposalSchema,
  setAccuracyVoteSchema,
]);

export type ContributionOperation = z.infer<
  typeof contributionOperationSchema
>;
