import { z } from 'zod';

import { opaqueTokenSchema, uuidV7Schema } from '../schema.js';
import {
  operationBatchSchema,
  studentOperationSchema,
} from './operation.js';
import {
  MAX_SYNC_PAGE_SIZE,
  SYNC_PROTOCOL_VERSION,
} from './limits.js';

const emptyOperationsSchema = z.array(studentOperationSchema).max(0);
const snapshotFields = {
  snapshot_token: opaqueTokenSchema.nullable(),
  page_token: opaqueTokenSchema.nullable(),
  snapshot_limit: z.number().int().min(1).max(MAX_SYNC_PAGE_SIZE),
  operations: emptyOperationsSchema,
};

export const accountSnapshotRequestSchema = z
  .object({
    protocol_version: z.literal(SYNC_PROTOCOL_VERSION),
    mode: z.literal('account_snapshot'),
    ...snapshotFields,
  })
  .strict();

export const classSectionSnapshotRequestSchema = z
  .object({
    protocol_version: z.literal(SYNC_PROTOCOL_VERSION),
    mode: z.literal('class_section_snapshot'),
    cursor: opaqueTokenSchema,
    class_section_id: uuidV7Schema,
    ...snapshotFields,
  })
  .strict();

export const incrementalSyncRequestSchema = z
  .object({
    protocol_version: z.literal(SYNC_PROTOCOL_VERSION),
    mode: z.literal('incremental'),
    cursor: opaqueTokenSchema,
    event_limit: z.number().int().min(1).max(MAX_SYNC_PAGE_SIZE),
    operations: operationBatchSchema,
  })
  .strict();

export const syncRequestSchema = z.discriminatedUnion('mode', [
  accountSnapshotRequestSchema,
  classSectionSnapshotRequestSchema,
  incrementalSyncRequestSchema,
]);

export type SyncRequest = z.infer<typeof syncRequestSchema>;
