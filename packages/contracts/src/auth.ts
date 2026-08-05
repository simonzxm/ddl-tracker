import { z } from 'zod';

import {
  evidenceUrlSchema,
  normalizedTextSchema,
  nullableNormalizedTextSchema,
  opaqueTokenSchema,
  rfc3339TimestampSchema,
  uuidV7Schema,
} from './schema.js';
import { parseUsername } from './validation.js';

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
const redirectUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.username === '' && url.password === '';
    } catch {
      return false;
    }
  }, 'Redirect URI must be an absolute URL without credentials.');

export const publicUserSchema = z
  .object({
    id: uuidV7Schema,
    username: usernameSchema,
    display_name: normalizedTextSchema(1, 64),
    avatar_url: evidenceUrlSchema.nullable(),
    bio: nullableNormalizedTextSchema(500),
    status: z.enum(['active', 'suspended', 'deleted']),
    profile_revision: z.number().int().positive(),
  })
  .strict();

export const currentUserSchema = publicUserSchema
  .extend({
    roles: z.array(z.literal('maintainer')).max(1),
  })
  .strict();

export const oidcAuthorizationRequestSchema = z
  .object({ redirect_uri: redirectUriSchema })
  .strict();

export const oidcAuthorizationResponseSchema = z
  .object({
    authorization_url: z.url(),
    expires_at: rfc3339TimestampSchema,
  })
  .strict();

export const oidcExchangeRequestSchema = z
  .object({
    code: opaqueTokenSchema,
    device_name: z.union([normalizedTextSchema(1, 100), z.null()]).default(null),
    device_metadata: deviceMetadataSchema.default({}),
  })
  .strict();

export const sessionVerificationResponseSchema = z
  .object({
    kind: z.literal('session'),
    access_token: opaqueTokenSchema,
    token_type: z.literal('Bearer'),
    expires_at: rfc3339TimestampSchema,
    user: currentUserSchema,
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

export const sessionListResponseSchema = z
  .object({
    sessions: z.array(sessionSchema),
  })
  .strict();

export const profileUpdateRequestSchema = z
  .object({
    username: usernameSchema,
    display_name: normalizedTextSchema(1, 64),
    avatar_url: evidenceUrlSchema.nullable(),
    bio: nullableNormalizedTextSchema(500),
    expected_revision: z.number().int().positive(),
  })
  .strict();

export type PublicUserWire = z.infer<typeof publicUserSchema>;
export type CurrentUserWire = z.infer<typeof currentUserSchema>;
export type OidcAuthorizationResponse = z.infer<
  typeof oidcAuthorizationResponseSchema
>;
export type SessionVerificationResponse = z.infer<
  typeof sessionVerificationResponseSchema
>;
export type SessionWire = z.infer<typeof sessionSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type OidcAuthorizationRequest = z.infer<
  typeof oidcAuthorizationRequestSchema
>;
export type OidcExchangeRequest = z.infer<typeof oidcExchangeRequestSchema>;
