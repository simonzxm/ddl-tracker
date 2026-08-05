import { z } from 'zod';

import {
  normalizedTextSchema,
  nullableNormalizedTextSchema,
  rfc3339TimestampSchema,
  uuidV7Schema,
} from './schema.js';
import {
  reportReasonSchema,
  reportTargetTypeSchema,
} from './sync/discussion-operation.js';

const adminReasonSchema = normalizedTextSchema(1, 1000);

export const adminBootstrapRequestSchema = z
  .object({
    bootstrap_token: z.string().min(1).max(4096),
  })
  .strict();

export const adminReportResolutionRequestSchema = z
  .object({
    status: z.enum(['resolved', 'dismissed']),
    resolution: adminReasonSchema,
  })
  .strict();

export const adminContentActionRequestSchema = z
  .object({
    target_type: z.enum(['course_task', 'proposal', 'comment']),
    reason: adminReasonSchema,
  })
  .strict();

export const adminUserActionRequestSchema = z
  .object({
    reason: adminReasonSchema,
  })
  .strict();

export const adminRoleRequestSchema = z
  .object({
    maintainer: z.boolean(),
    reason: adminReasonSchema,
  })
  .strict();

export const adminTaskMergeRequestSchema = z
  .object({
    target_task_id: uuidV7Schema,
    reason: adminReasonSchema,
  })
  .strict();

export const adminBootstrapResponseSchema = z
  .object({ maintainer: z.literal(true) })
  .strict();

export const adminContentActionResponseSchema = z
  .object({
    state: z.enum(['visible', 'hidden']),
    revision: z.number().int().positive(),
    changed: z.boolean(),
  })
  .strict();

export const adminReportStatusSchema = z.enum([
  'open',
  'resolved',
  'dismissed',
]);

export const adminPageCursorSchema = z
  .object({
    created_at: rfc3339TimestampSchema,
    id: uuidV7Schema,
  })
  .strict();

export const adminReportSchema = z
  .object({
    id: uuidV7Schema,
    reporter_id: uuidV7Schema,
    target_type: reportTargetTypeSchema,
    target_id: uuidV7Schema,
    reason: reportReasonSchema,
    details: nullableNormalizedTextSchema(1000),
    status: adminReportStatusSchema,
    resolution: nullableNormalizedTextSchema(1000),
    resolved_by: uuidV7Schema.nullable(),
    created_at: rfc3339TimestampSchema,
    resolved_at: rfc3339TimestampSchema.nullable(),
  })
  .strict();

export const adminReportPageSchema = z
  .object({
    reports: z.array(adminReportSchema).max(100),
    next: adminPageCursorSchema.nullable(),
  })
  .strict();

export const adminReportResolutionResponseSchema = z
  .object({
    status: z.enum(['resolved', 'dismissed']),
  })
  .strict();

export const adminUserActionResponseSchema = z
  .object({
    status: z.enum(['active', 'suspended']),
    changed: z.boolean(),
  })
  .strict();

export const adminRoleResponseSchema = z
  .object({
    maintainer: z.boolean(),
    changed: z.boolean(),
  })
  .strict();

export const adminTaskMergeResponseSchema = z
  .object({
    source_task_id: uuidV7Schema,
    target_task_id: uuidV7Schema,
    redirected_proposals: z.number().int().nonnegative(),
    moved_proposals: z.number().int().nonnegative(),
    recovered_personal_todos: z.number().int().nonnegative(),
  })
  .strict();

export const adminAuditEntrySchema = z
  .object({
    id: uuidV7Schema,
    actor_id: uuidV7Schema.nullable(),
    action: z.string(),
    target_type: z.string(),
    target_id: uuidV7Schema.nullable(),
    reason: nullableNormalizedTextSchema(1000),
    result: z.record(z.string(), z.unknown()),
    request_id: uuidV7Schema,
    created_at: rfc3339TimestampSchema,
  })
  .strict();

export const adminAuditPageSchema = z
  .object({
    entries: z.array(adminAuditEntrySchema).max(100),
    next: adminPageCursorSchema.nullable(),
  })
  .strict();

export type AdminBootstrapRequest = z.infer<
  typeof adminBootstrapRequestSchema
>;
export type AdminReportResolutionRequest = z.infer<
  typeof adminReportResolutionRequestSchema
>;
export type AdminContentActionRequest = z.infer<
  typeof adminContentActionRequestSchema
>;
export type AdminUserActionRequest = z.infer<
  typeof adminUserActionRequestSchema
>;
export type AdminRoleRequest = z.infer<typeof adminRoleRequestSchema>;
export type AdminTaskMergeRequest = z.infer<typeof adminTaskMergeRequestSchema>;
export type AdminBootstrapResponse = z.infer<
  typeof adminBootstrapResponseSchema
>;
export type AdminContentActionResponse = z.infer<
  typeof adminContentActionResponseSchema
>;
export type AdminReportPage = z.infer<typeof adminReportPageSchema>;
export type AdminReportResolutionResponse = z.infer<
  typeof adminReportResolutionResponseSchema
>;
export type AdminUserActionResponse = z.infer<
  typeof adminUserActionResponseSchema
>;
export type AdminRoleResponse = z.infer<typeof adminRoleResponseSchema>;
export type AdminTaskMergeResponse = z.infer<
  typeof adminTaskMergeResponseSchema
>;
export type AdminAuditPage = z.infer<typeof adminAuditPageSchema>;
