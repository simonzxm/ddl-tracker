import { z } from 'zod';

import { opaqueTokenSchema, uuidV7Schema } from '../schema.js';
import { MAX_SYNC_PAGE_SIZE, SYNC_PROTOCOL_VERSION } from './limits.js';
import {
  snapshotRecordV2Schema,
  type SnapshotRecordV2,
} from './snapshot-record.js';

export const snapshotRecordTypeSchema = z.enum([
  'catalog_revision',
  'public_user_profile',
  'followed_class_section',
  'class_section',
  'course_task',
  'task_proposal',
  'proposal_vote_totals',
  'accuracy_vote',
  'proposal_redirect',
  'task_merge',
  'personal_todo',
  'personal_task_details',
  'personal_task_state',
  'task_comment',
  'reporter_content_report',
  'content_tombstone',
]);

export const snapshotRecordSchema = snapshotRecordV2Schema;

const snapshotFields = {
  protocol_version: z.literal(SYNC_PROTOCOL_VERSION),
  request_id: uuidV7Schema,
  records: z.array(snapshotRecordSchema).max(MAX_SYNC_PAGE_SIZE),
  snapshot_token: opaqueTokenSchema,
  next_page_token: opaqueTokenSchema.nullable(),
  snapshot_complete: z.boolean(),
};

function validateCompletion(
  value: {
    snapshot_complete: boolean;
    next_page_token: string | null;
    completion_cursor: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (value.snapshot_complete) {
    if (value.next_page_token !== null) {
      context.addIssue({
        code: 'custom',
        path: ['next_page_token'],
        message: 'A complete snapshot cannot have another page token.',
      });
    }
    if (value.completion_cursor === null) {
      context.addIssue({
        code: 'custom',
        message: 'A complete snapshot must provide its completion cursor.',
      });
    }
    return;
  }

  if (value.next_page_token === null) {
    context.addIssue({
      code: 'custom',
      path: ['next_page_token'],
      message: 'An incomplete snapshot must provide another page token.',
    });
  }
  if (value.completion_cursor !== null) {
    context.addIssue({
      code: 'custom',
      message: 'An incomplete snapshot cannot provide a completion cursor.',
    });
  }
}

export const accountSnapshotResponseSchema = z
  .object({
    ...snapshotFields,
    mode: z.literal('account_snapshot'),
    next_cursor: opaqueTokenSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    validateCompletion(
      {
        snapshot_complete: value.snapshot_complete,
        next_page_token: value.next_page_token,
        completion_cursor: value.next_cursor,
      },
      context,
    );
  });

export const classSectionSnapshotResponseSchema = z
  .object({
    ...snapshotFields,
    mode: z.literal('class_section_snapshot'),
    class_section_id: uuidV7Schema,
    resume_cursor: opaqueTokenSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    validateCompletion(
      {
        snapshot_complete: value.snapshot_complete,
        next_page_token: value.next_page_token,
        completion_cursor: value.resume_cursor,
      },
      context,
    );
  });

export type SnapshotRecord = SnapshotRecordV2;
