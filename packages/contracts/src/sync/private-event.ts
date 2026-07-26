import { z } from 'zod';

import { rfc3339TimestampSchema, uuidV7Schema } from '../schema.js';
import { accuracyVoteRecordSchema } from './public-record.js';
import {
  followedClassSectionRecordSchema,
  personalTaskDetailsRecordSchema,
  personalTaskDetailsTombstoneSchema,
  personalTaskStateRecordSchema,
  personalTaskStateTombstoneSchema,
  personalTodoRecordSchema,
  personalTodoTombstoneSchema,
  reporterContentReportRecordSchema,
} from './private-record.js';

function syncEvent<const Type extends string, Payload extends z.ZodType>(
  type: Type,
  payload: Payload,
) {
  return z
    .object({
      event_id: uuidV7Schema,
      schema_version: z.literal(2),
      type: z.literal(type),
      occurred_at: rfc3339TimestampSchema,
      payload,
    })
    .strict();
}

const privateDeletionReasonSchema = z.enum([
  'task_merge_conflict',
  'task_merge_duplicate',
  'task_merge_moved',
  'task_merge_merged',
]);

const classSectionUnfollowedPayloadSchema = z
  .object({
    class_section_id: uuidV7Schema,
    unfollowed_at: rfc3339TimestampSchema,
  })
  .strict();

const accuracyVoteUpdatedPayloadSchema = accuracyVoteRecordSchema.extend({
  reason: z
    .enum(['task_merge_conflict', 'task_merge_moved'])
    .optional(),
});

const personalTaskDetailsDeletedPayloadSchema =
  personalTaskDetailsTombstoneSchema.extend({
    reason: privateDeletionReasonSchema.optional(),
  });
const personalTaskStateDeletedPayloadSchema =
  personalTaskStateTombstoneSchema.extend({
    reason: privateDeletionReasonSchema.optional(),
  });

export const reporterContentReportPayloadSchema =
  reporterContentReportRecordSchema;

export const classSectionFollowedEventV2Schema = syncEvent(
  'class_section_followed',
  followedClassSectionRecordSchema,
);
export const classSectionUnfollowedEventV2Schema = syncEvent(
  'class_section_unfollowed',
  classSectionUnfollowedPayloadSchema,
);
export const accuracyVoteUpdatedEventV2Schema = syncEvent(
  'accuracy_vote_updated',
  accuracyVoteUpdatedPayloadSchema,
);
export const personalTodoUpsertedEventV2Schema = syncEvent(
  'personal_todo_upserted',
  personalTodoRecordSchema,
);
export const personalTodoDeletedEventV2Schema = syncEvent(
  'personal_todo_deleted',
  personalTodoTombstoneSchema,
);
export const personalTaskDetailsUpsertedEventV2Schema = syncEvent(
  'personal_task_details_upserted',
  personalTaskDetailsRecordSchema,
);
export const personalTaskDetailsDeletedEventV2Schema = syncEvent(
  'personal_task_details_deleted',
  personalTaskDetailsDeletedPayloadSchema,
);
export const personalTaskStateUpsertedEventV2Schema = syncEvent(
  'personal_task_state_upserted',
  personalTaskStateRecordSchema,
);
export const personalTaskStateDeletedEventV2Schema = syncEvent(
  'personal_task_state_deleted',
  personalTaskStateDeletedPayloadSchema,
);
export const reporterContentReportUpdatedEventV2Schema = syncEvent(
  'reporter_content_report_updated',
  reporterContentReportPayloadSchema,
);

export const privateSyncEventV2Schema = z.discriminatedUnion('type', [
  classSectionFollowedEventV2Schema,
  classSectionUnfollowedEventV2Schema,
  accuracyVoteUpdatedEventV2Schema,
  personalTodoUpsertedEventV2Schema,
  personalTodoDeletedEventV2Schema,
  personalTaskDetailsUpsertedEventV2Schema,
  personalTaskDetailsDeletedEventV2Schema,
  personalTaskStateUpsertedEventV2Schema,
  personalTaskStateDeletedEventV2Schema,
  reporterContentReportUpdatedEventV2Schema,
]);

export type PrivateSyncEventV2 = z.infer<typeof privateSyncEventV2Schema>;
