import { z } from 'zod';

import {
  rfc3339TimestampSchema,
  storedTextSchema,
  uuidV7Schema,
} from './schema.js';

export const commentRevisionWireSchema = z
  .object({
    revision: z.number().int().positive(),
    body: storedTextSchema,
    author_id: uuidV7Schema.nullable(),
    created_at: rfc3339TimestampSchema,
  })
  .strict();

export const commentRevisionPageSchema = z
  .object({
    comment_id: uuidV7Schema,
    revisions: z.array(commentRevisionWireSchema).max(100),
    next_after_revision: z.number().int().positive().nullable(),
  })
  .strict();

export type CommentRevisionWire = z.infer<typeof commentRevisionWireSchema>;
export type CommentRevisionPage = z.infer<typeof commentRevisionPageSchema>;
