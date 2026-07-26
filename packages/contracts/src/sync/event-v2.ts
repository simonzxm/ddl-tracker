import { z } from 'zod';

import { maintainerContentReportUpdatedEventV2Schema } from './maintainer-event.js';
import {
  accuracyVoteUpdatedEventV2Schema,
  classSectionFollowedEventV2Schema,
  classSectionUnfollowedEventV2Schema,
  personalTaskDetailsDeletedEventV2Schema,
  personalTaskDetailsUpsertedEventV2Schema,
  personalTaskStateDeletedEventV2Schema,
  personalTaskStateUpsertedEventV2Schema,
  personalTodoDeletedEventV2Schema,
  personalTodoUpsertedEventV2Schema,
  reporterContentReportUpdatedEventV2Schema,
} from './private-event.js';
import {
  classSectionDeactivatedEventV2Schema,
  courseTaskCreatedEventV2Schema,
  courseTaskHiddenEventV2Schema,
  courseTaskMergedEventV2Schema,
  courseTaskRestoredEventV2Schema,
  proposalVoteTotalsUpdatedEventV2Schema,
  publicUserDeletedEventV2Schema,
  publicUserProfileUpdatedEventV2Schema,
  taskCommentDeletedEventV2Schema,
  taskCommentHiddenEventV2Schema,
  taskCommentRestoredEventV2Schema,
  taskCommentUpsertedEventV2Schema,
  taskProposalCreatedEventV2Schema,
  taskProposalHiddenEventV2Schema,
  taskProposalRedirectedEventV2Schema,
  taskProposalRestoredEventV2Schema,
} from './public-event.js';

export const syncEventV2Schema = z.discriminatedUnion('type', [
  classSectionFollowedEventV2Schema,
  classSectionUnfollowedEventV2Schema,
  courseTaskCreatedEventV2Schema,
  courseTaskMergedEventV2Schema,
  courseTaskHiddenEventV2Schema,
  courseTaskRestoredEventV2Schema,
  taskProposalCreatedEventV2Schema,
  taskProposalHiddenEventV2Schema,
  taskProposalRestoredEventV2Schema,
  taskProposalRedirectedEventV2Schema,
  proposalVoteTotalsUpdatedEventV2Schema,
  accuracyVoteUpdatedEventV2Schema,
  personalTodoUpsertedEventV2Schema,
  personalTodoDeletedEventV2Schema,
  personalTaskDetailsUpsertedEventV2Schema,
  personalTaskDetailsDeletedEventV2Schema,
  personalTaskStateUpsertedEventV2Schema,
  personalTaskStateDeletedEventV2Schema,
  taskCommentUpsertedEventV2Schema,
  taskCommentDeletedEventV2Schema,
  taskCommentHiddenEventV2Schema,
  taskCommentRestoredEventV2Schema,
  publicUserProfileUpdatedEventV2Schema,
  publicUserDeletedEventV2Schema,
  reporterContentReportUpdatedEventV2Schema,
  maintainerContentReportUpdatedEventV2Schema,
  classSectionDeactivatedEventV2Schema,
]);

export type SyncEventV2 = z.infer<typeof syncEventV2Schema>;
export type SyncEventV2Type = SyncEventV2['type'];
