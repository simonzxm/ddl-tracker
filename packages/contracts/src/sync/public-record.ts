import { z } from 'zod';

import {
  rfc3339TimestampSchema,
  storedResponseTextSchema,
  uuidV7Schema,
} from '../schema.js';

const revisionSchema = z.number().int().positive();

export const catalogRevisionRecordSchema = z
  .object({
    revision: revisionSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const classSectionRecordSchema = z
  .object({
    id: uuidV7Schema,
    course_id: uuidV7Schema,
    external_section_id: storedResponseTextSchema,
    section_number: storedResponseTextSchema,
    department_code: storedResponseTextSchema.nullable(),
    department_name: storedResponseTextSchema.nullable(),
    instructors: z.array(storedResponseTextSchema),
    campus: storedResponseTextSchema.nullable(),
    capacity: z.number().int().nonnegative().nullable(),
    schedule_text: storedResponseTextSchema.nullable(),
    active: z.boolean(),
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const courseTaskRecordSchema = z
  .object({
    id: uuidV7Schema,
    class_section_id: uuidV7Schema,
    created_by: uuidV7Schema.nullable(),
    state: z.literal('visible'),
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const taskProposalRecordSchema = z
  .object({
    id: uuidV7Schema,
    course_task_id: uuidV7Schema,
    author_id: uuidV7Schema.nullable(),
    title: storedResponseTextSchema,
    deadline: rfc3339TimestampSchema,
    description: storedResponseTextSchema.nullable(),
    evidence_note: storedResponseTextSchema.nullable(),
    evidence_url: storedResponseTextSchema.nullable(),
    content_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    state: z.literal('visible'),
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
  })
  .strict();

export const publicUserProfileRecordSchema = z
  .object({
    id: uuidV7Schema,
    username: storedResponseTextSchema,
    display_name: storedResponseTextSchema,
    avatar_url: storedResponseTextSchema.nullable(),
    bio: storedResponseTextSchema.nullable(),
    status: z.enum(['active', 'suspended']),
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const proposalVoteTotalsRecordSchema = z
  .object({
    proposal_id: uuidV7Schema,
    up: z.number().int().nonnegative(),
    down: z.number().int().nonnegative(),
    revision: revisionSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const accuracyVoteRecordSchema = z
  .object({
    proposal_id: uuidV7Schema,
    value: z.enum(['up', 'down', 'none']),
    revision: revisionSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const proposalRedirectRecordSchema = z
  .object({
    source_proposal_id: uuidV7Schema,
    canonical_proposal_id: uuidV7Schema,
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
  })
  .strict();

export const taskMergeRecordSchema = z
  .object({
    source_task_id: uuidV7Schema,
    target_task_id: uuidV7Schema,
    reason: storedResponseTextSchema,
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
  })
  .strict();

export const taskCommentRecordSchema = z
  .object({
    id: uuidV7Schema,
    course_task_id: uuidV7Schema,
    author_id: uuidV7Schema.nullable(),
    body: storedResponseTextSchema,
    revision: revisionSchema,
    state: z.literal('visible'),
    deleted_at: z.null(),
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const hiddenCourseTaskTombstoneSchema = z
  .object({
    entity_type: z.literal('course_task'),
    entity_id: uuidV7Schema,
    state: z.literal('hidden'),
    revision: revisionSchema,
  })
  .strict();

export const hiddenTaskProposalTombstoneSchema = z
  .object({
    entity_type: z.literal('task_proposal'),
    entity_id: uuidV7Schema,
    state: z.literal('hidden'),
    revision: revisionSchema,
  })
  .strict();

export const hiddenTaskCommentTombstoneSchema = z
  .object({
    entity_type: z.literal('task_comment'),
    entity_id: uuidV7Schema,
    state: z.literal('hidden'),
    revision: revisionSchema,
  })
  .strict();

export const deletedTaskCommentTombstoneSchema = z
  .object({
    entity_type: z.literal('task_comment'),
    entity_id: uuidV7Schema,
    state: z.literal('deleted'),
    revision: revisionSchema,
    deleted_at: rfc3339TimestampSchema,
  })
  .strict();

export const contentTombstoneSchema = z.union([
  hiddenCourseTaskTombstoneSchema,
  hiddenTaskProposalTombstoneSchema,
  hiddenTaskCommentTombstoneSchema,
  deletedTaskCommentTombstoneSchema,
]);

export type ClassSectionRecord = z.infer<typeof classSectionRecordSchema>;
export type CourseTaskRecord = z.infer<typeof courseTaskRecordSchema>;
export type TaskProposalRecord = z.infer<typeof taskProposalRecordSchema>;
export type PublicUserProfileRecord = z.infer<
  typeof publicUserProfileRecordSchema
>;
export type ProposalVoteTotalsRecord = z.infer<
  typeof proposalVoteTotalsRecordSchema
>;
export type AccuracyVoteRecord = z.infer<typeof accuracyVoteRecordSchema>;
export type ProposalRedirectRecord = z.infer<
  typeof proposalRedirectRecordSchema
>;
export type TaskMergeRecord = z.infer<typeof taskMergeRecordSchema>;
export type TaskCommentRecord = z.infer<typeof taskCommentRecordSchema>;
export type ContentTombstone = z.infer<typeof contentTombstoneSchema>;
