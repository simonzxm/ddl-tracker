import { z } from 'zod';

import {
  normalizedTextSchema,
  opaqueTokenSchema,
  rfc3339TimestampSchema,
  uuidV7Schema,
} from './schema.js';
import { parseUsername } from './validation.js';

const emailSchema = z.string().trim().min(3).max(320);
const usernameSchema = z.string().transform((value, context) => {
  try {
    return parseUsername(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid username.',
    });
    return z.NEVER;
  }
});
const deviceMetadataSchema = z.record(z.string(), z.unknown());

export const publicUserSchema = z
  .object({
    id: uuidV7Schema,
    username: usernameSchema,
    display_name: normalizedTextSchema(1, 64),
    status: z.enum(['active', 'suspended', 'deleted']),
    profile_revision: z.number().int().positive(),
  })
  .strict();

export const emailChallengeRequestSchema = z
  .object({ email: emailSchema })
  .strict();

export const emailChallengeResponseSchema = z
  .object({
    challenge_id: uuidV7Schema,
    expires_at: rfc3339TimestampSchema,
  })
  .strict();

export const emailVerificationRequestSchema = z
  .object({
    challenge_id: uuidV7Schema,
    email: emailSchema,
    code: z.string().regex(/^\d{6}$/u),
    device_name: z.union([normalizedTextSchema(1, 100), z.null()]).default(null),
    device_metadata: deviceMetadataSchema.default({}),
  })
  .strict();

export const registrationVerificationResponseSchema = z
  .object({
    kind: z.literal('registration'),
    registration_token: opaqueTokenSchema,
    expires_at: rfc3339TimestampSchema,
  })
  .strict();

export const sessionVerificationResponseSchema = z
  .object({
    kind: z.literal('session'),
    access_token: opaqueTokenSchema,
    token_type: z.literal('Bearer'),
    expires_at: rfc3339TimestampSchema,
    user: publicUserSchema,
  })
  .strict();

export const verificationResponseSchema = z.discriminatedUnion('kind', [
  registrationVerificationResponseSchema,
  sessionVerificationResponseSchema,
]);

export const accountRegistrationRequestSchema = z
  .object({
    registration_token: opaqueTokenSchema,
    username: usernameSchema,
    display_name: z.union([normalizedTextSchema(1, 64), z.null()]).default(null),
    device_name: z.union([normalizedTextSchema(1, 100), z.null()]).default(null),
    device_metadata: deviceMetadataSchema.default({}),
  })
  .strict();

export const sessionSchema = z
  .object({
    id: uuidV7Schema,
    device_name: z.string().nullable(),
    device_metadata: deviceMetadataSchema,
    created_at: rfc3339TimestampSchema,
    last_seen_at: rfc3339TimestampSchema,
    idle_expires_at: rfc3339TimestampSchema,
    absolute_expires_at: rfc3339TimestampSchema,
    revoked_at: rfc3339TimestampSchema.nullable(),
  })
  .strict();

export const profileUpdateRequestSchema = z
  .object({
    username: usernameSchema,
    display_name: normalizedTextSchema(1, 64),
    expected_revision: z.number().int().positive(),
  })
  .strict();

export type PublicUserWire = z.infer<typeof publicUserSchema>;
export type EmailChallengeRequest = z.infer<typeof emailChallengeRequestSchema>;
export type EmailVerificationRequest = z.infer<
  typeof emailVerificationRequestSchema
>;
export type AccountRegistrationRequest = z.infer<
  typeof accountRegistrationRequestSchema
>;
