import { z } from 'zod';

import { rfc3339TimestampSchema, uuidV7Schema } from '../schema.js';
import {
  classSectionRecordSchema,
  courseTaskRecordSchema,
  deletedTaskCommentTombstoneSchema,
  hiddenCourseTaskTombstoneSchema,
  hiddenTaskCommentTombstoneSchema,
  hiddenTaskProposalTombstoneSchema,
  proposalRedirectRecordSchema,
  proposalVoteTotalsRecordSchema,
  publicUserProfileRecordSchema,
  taskCommentRecordSchema,
  taskMergeRecordSchema,
  taskProposalRecordSchema,
} from './public-record.js';

function syncEvent<const Type extends string, Payload extends z.ZodType>(
  type: Type,
  payload: Payload,
) {
  return z
    .object({
      event_id: uuidV7Schema,
      schema_version: z.literal(1),
      type: z.literal(type),
      occurred_at: rfc3339TimestampSchema,
      payload,
    })
    .strict();
}

const courseTaskMergedPayloadSchema = taskMergeRecordSchema.extend({
  redirected_proposals: z.number().int().nonnegative(),
  moved_proposals: z.number().int().nonnegative(),
  recovered_personal_todos: z.number().int().nonnegative(),
});

const publicUserDeletedPayloadSchema = z
  .object({
    id: uuidV7Schema,
    display_name: z.literal('已注销用户'),
    status: z.literal('deleted'),
    revision: z.number().int().positive(),
    deleted_at: rfc3339TimestampSchema,
  })
  .strict();

const classSectionDeactivatedPayloadSchema = classSectionRecordSchema.pick({
  id: true,
  external_section_id: true,
  active: true,
  revision: true,
  updated_at: true,
}).refine((value) => !value.active, {
  message: 'A deactivation event must set active to false.',
  path: ['active'],
});

export const courseTaskCreatedEventV2Schema = syncEvent(
  'course_task_created',
  courseTaskRecordSchema,
);
export const courseTaskMergedEventV2Schema = syncEvent(
  'course_task_merged',
  courseTaskMergedPayloadSchema,
);
export const courseTaskHiddenEventV2Schema = syncEvent(
  'course_task_hidden',
  hiddenCourseTaskTombstoneSchema,
);
export const courseTaskRestoredEventV2Schema = syncEvent(
  'course_task_restored',
  courseTaskRecordSchema,
);
export const taskProposalCreatedEventV2Schema = syncEvent(
  'task_proposal_created',
  taskProposalRecordSchema,
);
export const taskProposalHiddenEventV2Schema = syncEvent(
  'task_proposal_hidden',
  hiddenTaskProposalTombstoneSchema,
);
export const taskProposalRestoredEventV2Schema = syncEvent(
  'task_proposal_restored',
  taskProposalRecordSchema,
);
export const taskProposalRedirectedEventV2Schema = syncEvent(
  'task_proposal_redirected',
  proposalRedirectRecordSchema,
);
export const proposalVoteTotalsUpdatedEventV2Schema = syncEvent(
  'proposal_vote_totals_updated',
  proposalVoteTotalsRecordSchema,
);
export const taskCommentUpsertedEventV2Schema = syncEvent(
  'task_comment_upserted',
  taskCommentRecordSchema,
);
export const taskCommentDeletedEventV2Schema = syncEvent(
  'task_comment_deleted',
  deletedTaskCommentTombstoneSchema,
);
export const taskCommentHiddenEventV2Schema = syncEvent(
  'task_comment_hidden',
  hiddenTaskCommentTombstoneSchema,
);
export const taskCommentRestoredEventV2Schema = syncEvent(
  'task_comment_restored',
  taskCommentRecordSchema,
);
export const publicUserProfileUpdatedEventV2Schema = syncEvent(
  'public_user_profile_updated',
  publicUserProfileRecordSchema,
);
export const publicUserDeletedEventV2Schema = syncEvent(
  'public_user_deleted',
  publicUserDeletedPayloadSchema,
);
export const classSectionDeactivatedEventV2Schema = syncEvent(
  'class_section_deactivated',
  classSectionDeactivatedPayloadSchema,
);

export const publicSyncEventV2Schema = z.discriminatedUnion('type', [
  courseTaskCreatedEventV2Schema,
  courseTaskMergedEventV2Schema,
  courseTaskHiddenEventV2Schema,
  courseTaskRestoredEventV2Schema,
  taskProposalCreatedEventV2Schema,
  taskProposalHiddenEventV2Schema,
  taskProposalRestoredEventV2Schema,
  taskProposalRedirectedEventV2Schema,
  proposalVoteTotalsUpdatedEventV2Schema,
  taskCommentUpsertedEventV2Schema,
  taskCommentDeletedEventV2Schema,
  taskCommentHiddenEventV2Schema,
  taskCommentRestoredEventV2Schema,
  publicUserProfileUpdatedEventV2Schema,
  publicUserDeletedEventV2Schema,
  classSectionDeactivatedEventV2Schema,
]);

export type PublicSyncEventV2 = z.infer<typeof publicSyncEventV2Schema>;
