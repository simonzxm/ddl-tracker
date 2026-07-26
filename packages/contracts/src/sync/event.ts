import { z } from 'zod';

import { syncEventV2Schema, type SyncEventV2 } from './event-v2.js';

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
  'reporter_content_report_updated',
  'maintainer_content_report_updated',
  'class_section_deactivated',
]);

export const syncEventSchema = syncEventV2Schema;

export type SyncEventScope = z.infer<typeof syncEventScopeSchema>;
export type SyncEventType = z.infer<typeof syncEventTypeSchema>;
export type SyncEvent = SyncEventV2;
