import { z } from 'zod';

import { normalizedTextSchema, uuidV7Schema } from './schema.js';

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
