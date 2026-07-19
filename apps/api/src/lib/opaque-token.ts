import { z } from 'zod';

import { uuidV7Schema } from '@ddl-tracker/contracts';

const tokenPayloadSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(['sync_cursor', 'snapshot', 'snapshot_page']),
    user_id: uuidV7Schema,
    environment: z.string().min(1).max(64),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().positive(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine((value) => value.expires_at > value.issued_at, {
    message: 'Token expiry must be after issue time.',
  });

export type OpaqueTokenPayload = z.infer<typeof tokenPayloadSchema>;
export type OpaqueTokenKind = OpaqueTokenPayload['kind'];

export interface OpaqueTokenBinding {
  kind: OpaqueTokenKind;
  user_id: string;
  environment: string;
  now: number;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < 32) {
    throw new Error('Opaque token signing keys must contain at least 32 bytes.');
  }

  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signOpaqueToken(
  input: OpaqueTokenPayload,
  secret: string,
): Promise<string> {
  const payload = tokenPayloadSchema.parse(input);
  const payloadSegment = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signingInput = `v1.${payloadSegment}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importSigningKey(secret),
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyOpaqueToken(
  token: string,
  secret: string,
  binding: OpaqueTokenBinding,
): Promise<OpaqueTokenPayload> {
  const segments = token.split('.');
  const version = segments[0];
  const payloadSegment = segments[1];
  const signatureSegment = segments[2];
  if (
    segments.length !== 3 ||
    version !== 'v1' ||
    payloadSegment === undefined ||
    signatureSegment === undefined
  ) {
    throw new Error('Invalid token signature.');
  }

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = decodeBase64Url(signatureSegment);
  } catch {
    throw new Error('Invalid token signature.');
  }

  const signingInput = `${version}.${payloadSegment}`;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importSigningKey(secret),
    signature,
    new TextEncoder().encode(signingInput),
  );
  if (!valid) {
    throw new Error('Invalid token signature.');
  }

  let payload: OpaqueTokenPayload;
  try {
    payload = tokenPayloadSchema.parse(
      JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadSegment))),
    );
  } catch {
    throw new Error('Invalid token payload.');
  }

  if (
    payload.kind !== binding.kind ||
    payload.user_id !== binding.user_id ||
    payload.environment !== binding.environment
  ) {
    throw new Error('Opaque token binding does not match this request.');
  }
  if (binding.now < payload.issued_at) {
    throw new Error('Opaque token is not active yet.');
  }
  if (binding.now > payload.expires_at) {
    throw new Error('Opaque token has expired.');
  }

  return payload;
}
