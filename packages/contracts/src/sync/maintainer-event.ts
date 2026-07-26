import { z } from 'zod';

import {
  normalizedTextSchema,
  nullableNormalizedTextSchema,
  rfc3339TimestampSchema,
  uuidV7Schema,
} from '../schema.js';
import {
  reportReasonSchema,
  reportTargetTypeSchema,
} from './discussion-operation.js';

const reportIdentityFields = {
  report_id: uuidV7Schema,
  reporter_id: uuidV7Schema,
  target_type: reportTargetTypeSchema,
  target_id: uuidV7Schema,
  reason: reportReasonSchema,
  details: nullableNormalizedTextSchema(1000),
  created_at: rfc3339TimestampSchema,
};

const openMaintainerReportSchema = z
  .object({
    ...reportIdentityFields,
    status: z.literal('open'),
    resolution: z.null(),
    resolved_at: z.null(),
  })
  .strict();
const resolvedMaintainerReportSchema = z
  .object({
    ...reportIdentityFields,
    status: z.literal('resolved'),
    resolution: normalizedTextSchema(1, 1000),
    resolved_at: rfc3339TimestampSchema,
  })
  .strict();
const dismissedMaintainerReportSchema = z
  .object({
    ...reportIdentityFields,
    status: z.literal('dismissed'),
    resolution: normalizedTextSchema(1, 1000),
    resolved_at: rfc3339TimestampSchema,
  })
  .strict();

export const maintainerContentReportRecordSchema = z.discriminatedUnion(
  'status',
  [
    openMaintainerReportSchema,
    resolvedMaintainerReportSchema,
    dismissedMaintainerReportSchema,
  ],
);

export const maintainerContentReportUpdatedEventV2Schema = z
  .object({
    event_id: uuidV7Schema,
    schema_version: z.literal(2),
    type: z.literal('maintainer_content_report_updated'),
    occurred_at: rfc3339TimestampSchema,
    payload: maintainerContentReportRecordSchema,
  })
  .strict();

export const maintainerSyncEventV2Schema =
  maintainerContentReportUpdatedEventV2Schema;

export type MaintainerContentReportRecord = z.infer<
  typeof maintainerContentReportRecordSchema
>;
export type MaintainerSyncEventV2 = z.infer<
  typeof maintainerSyncEventV2Schema
>;
