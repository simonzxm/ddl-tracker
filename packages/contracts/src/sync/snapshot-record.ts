import { z } from 'zod';

import {
  accuracyVoteRecordSchema,
  catalogRevisionRecordSchema,
  classSectionRecordSchema,
  contentTombstoneSchema,
  courseTaskRecordSchema,
  proposalRedirectRecordSchema,
  proposalVoteTotalsRecordSchema,
  publicUserProfileRecordSchema,
  taskCommentRecordSchema,
  taskMergeRecordSchema,
  taskProposalRecordSchema,
} from './public-record.js';
import {
  followedClassSectionRecordSchema,
  personalTaskDetailsRecordSchema,
  personalTaskStateRecordSchema,
  personalTodoRecordSchema,
  reporterContentReportRecordSchema,
} from './private-record.js';

function snapshotRecord<const Type extends string, Payload extends z.ZodType>(
  recordType: Type,
  payload: Payload,
) {
  return z
    .object({
      record_type: z.literal(recordType),
      schema_version: z.literal(1),
      payload,
    })
    .strict();
}

export const catalogRevisionSnapshotRecordSchema = snapshotRecord(
  'catalog_revision',
  catalogRevisionRecordSchema,
);
export const publicUserProfileSnapshotRecordSchema = snapshotRecord(
  'public_user_profile',
  publicUserProfileRecordSchema,
);
export const followedClassSectionSnapshotRecordSchema = snapshotRecord(
  'followed_class_section',
  followedClassSectionRecordSchema,
);
export const classSectionSnapshotRecordSchema = snapshotRecord(
  'class_section',
  classSectionRecordSchema,
);
export const courseTaskSnapshotRecordSchema = snapshotRecord(
  'course_task',
  courseTaskRecordSchema,
);
export const taskProposalSnapshotRecordSchema = snapshotRecord(
  'task_proposal',
  taskProposalRecordSchema,
);
export const proposalVoteTotalsSnapshotRecordSchema = snapshotRecord(
  'proposal_vote_totals',
  proposalVoteTotalsRecordSchema,
);
export const accuracyVoteSnapshotRecordSchema = snapshotRecord(
  'accuracy_vote',
  accuracyVoteRecordSchema,
);
export const proposalRedirectSnapshotRecordSchema = snapshotRecord(
  'proposal_redirect',
  proposalRedirectRecordSchema,
);
export const taskMergeSnapshotRecordSchema = snapshotRecord(
  'task_merge',
  taskMergeRecordSchema,
);
export const personalTodoSnapshotRecordSchema = snapshotRecord(
  'personal_todo',
  personalTodoRecordSchema,
);
export const personalTaskDetailsSnapshotRecordSchema = snapshotRecord(
  'personal_task_details',
  personalTaskDetailsRecordSchema,
);
export const personalTaskStateSnapshotRecordSchema = snapshotRecord(
  'personal_task_state',
  personalTaskStateRecordSchema,
);
export const taskCommentSnapshotRecordSchema = snapshotRecord(
  'task_comment',
  taskCommentRecordSchema,
);
export const reporterContentReportSnapshotRecordSchema = snapshotRecord(
  'reporter_content_report',
  reporterContentReportRecordSchema,
);
export const contentTombstoneSnapshotRecordSchema = snapshotRecord(
  'content_tombstone',
  contentTombstoneSchema,
);

export const snapshotRecordV2Schema = z.discriminatedUnion('record_type', [
  catalogRevisionSnapshotRecordSchema,
  publicUserProfileSnapshotRecordSchema,
  followedClassSectionSnapshotRecordSchema,
  classSectionSnapshotRecordSchema,
  courseTaskSnapshotRecordSchema,
  taskProposalSnapshotRecordSchema,
  proposalVoteTotalsSnapshotRecordSchema,
  accuracyVoteSnapshotRecordSchema,
  proposalRedirectSnapshotRecordSchema,
  taskMergeSnapshotRecordSchema,
  personalTodoSnapshotRecordSchema,
  personalTaskDetailsSnapshotRecordSchema,
  personalTaskStateSnapshotRecordSchema,
  taskCommentSnapshotRecordSchema,
  reporterContentReportSnapshotRecordSchema,
  contentTombstoneSnapshotRecordSchema,
]);

export type SnapshotRecordV2 = z.infer<typeof snapshotRecordV2Schema>;
export type SnapshotRecordType = SnapshotRecordV2['record_type'];
