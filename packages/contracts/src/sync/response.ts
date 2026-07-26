import { z } from 'zod';

import { apiErrorCodeSchema } from '../error.js';
import { opaqueTokenSchema, uuidV7Schema } from '../schema.js';
import { syncEventSchema } from './event.js';
import {
  MAX_SYNC_OPERATIONS,
  MAX_SYNC_PAGE_SIZE,
  SYNC_PROTOCOL_VERSION,
} from './limits.js';

const operationErrorFields = {
  details: z.record(z.string(), z.unknown()),
  message: z.string().min(1).max(500),
  retryable: z.literal(false),
};

const successResultSchema = z
  .object({
    operation_id: uuidV7Schema,
    status: z.enum(['applied', 'replayed']),
    result: z.record(z.string(), z.unknown()),
  })
  .strict();

const rejectedResultSchema = z
  .object({
    operation_id: uuidV7Schema,
    status: z.literal('rejected'),
    error: z
      .object({
        code: apiErrorCodeSchema,
        ...operationErrorFields,
      })
      .strict(),
  })
  .strict();

const dependencyFailedResultSchema = z
  .object({
    operation_id: uuidV7Schema,
    status: z.literal('dependency_failed'),
    error: z
      .object({
        code: z.literal('dependency_failed'),
        ...operationErrorFields,
      })
      .strict(),
  })
  .strict();

export const operationResultSchema = z.discriminatedUnion('status', [
  successResultSchema,
  rejectedResultSchema,
  dependencyFailedResultSchema,
]);

export const incrementalSyncResponseSchema = z
  .object({
    protocol_version: z.literal(SYNC_PROTOCOL_VERSION),
    mode: z.literal('incremental'),
    request_id: uuidV7Schema,
    operation_results: z
      .array(operationResultSchema)
      .max(MAX_SYNC_OPERATIONS),
    events: z.array(syncEventSchema).max(MAX_SYNC_PAGE_SIZE),
    next_cursor: opaqueTokenSchema,
    has_more: z.boolean(),
  })
  .strict();

export type OperationResult = z.infer<typeof operationResultSchema>;
export type IncrementalSyncResponse = z.infer<
  typeof incrementalSyncResponseSchema
>;
