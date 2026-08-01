import { z } from 'zod';

import { uuidV7Schema } from './schema.js';

export const apiErrorCodeSchema = z.enum([
  'account_suspended',
  'conflict',
  'content_hidden',
  'cursor_expired',
  'dependency_failed',
  'duplicate_proposal',
  'forbidden',
  'inactive_term',
  'internal_error',
  'invalid_request',
  'method_not_allowed',
  'not_found',
  'operation_id_reused',
  'payload_too_large',
  'protocol_version_unsupported',
  'rate_limited',
  'revision_conflict',
  'temporarily_unavailable',
  'unauthenticated',
  'unsupported_media_type',
  'username_taken',
]);

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    details: z.record(z.string(), z.unknown()),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    retry_after: z.number().int().positive().optional(),
    request_id: uuidV7Schema,
  })
  .strict();

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
