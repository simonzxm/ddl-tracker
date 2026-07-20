import { z } from 'zod';

import { rfc3339TimestampSchema, uuidV7Schema } from '../schema.js';

export const syncEventScopeSchema = z.enum([
  'private_user',
  'class_section_public',
  'authenticated_global',
  'maintainer_private',
]);

export const syncEventTypeSchema = z.enum([
  'class_section_followed',
  'class_section_unfollowed',
  'course_task_created',
  'course_task_merged',
  'course_task_hidden',
  'course_task_restored',
  'task_proposal_created',
  'task_proposal_hidden',
  'task_proposal_restored',
  'task_proposal_redirected',
  'proposal_vote_totals_updated',
  'accuracy_vote_updated',
  'personal_todo_upserted',
  'personal_todo_deleted',
  'personal_task_details_upserted',
  'personal_task_details_deleted',
  'personal_task_state_upserted',
  'personal_task_state_deleted',
  'task_comment_upserted',
  'task_comment_deleted',
  'task_comment_hidden',
  'task_comment_restored',
  'public_user_profile_updated',
  'public_user_deleted',
  'content_report_status_updated',
  'class_section_deactivated',
]);

export const syncEventSchema = z
  .object({
    event_id: uuidV7Schema,
    schema_version: z.literal(1),
    type: syncEventTypeSchema,
    occurred_at: rfc3339TimestampSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type SyncEventScope = z.infer<typeof syncEventScopeSchema>;
export type SyncEventType = z.infer<typeof syncEventTypeSchema>;
export type SyncEvent = z.infer<typeof syncEventSchema>;
