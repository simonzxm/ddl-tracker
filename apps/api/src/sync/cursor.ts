import { z } from 'zod';

const cursorPayloadSchema = z
  .object({
    version: z.literal(1),
    user_id: z.uuid(),
    environment: z.string().min(1).max(100),
    sequence: z.number().int().nonnegative(),
  })
  .strict();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Sync cursor is malformed.');
  }
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch (error) {
    throw new Error('Sync cursor is malformed.', { cause: error });
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export class SyncCursorCodec {
  readonly #secret: string;
  readonly #environment: string;

  constructor(secret: string, environment: string) {
    if (secret.length < 32) {
      throw new Error('Sync cursor secret must contain at least 32 characters.');
    }
    if (environment.length === 0) {
      throw new Error('Sync cursor environment is required.');
    }
    this.#secret = secret;
    this.#environment = environment;
  }

  async encode(userId: string, sequence: number): Promise<string> {
    const payload = cursorPayloadSchema.parse({
      version: 1,
      user_id: userId,
      environment: this.#environment,
      sequence,
    });
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const signature = await this.#sign(body);
    return `${encodeBase64Url(body)}.${encodeBase64Url(signature)}`;
  }

  async decode(
    cursor: string,
    expectedUserId: string,
  ): Promise<{ sequence: number }> {
    const parts = cursor.split('.');
    if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
      throw new Error('Sync cursor is malformed.');
    }
    const body = decodeBase64Url(parts[0]);
    const signature = decodeBase64Url(parts[1]);
    const valid = await this.#verify(body, signature);
    if (!valid) {
      throw new Error('Sync cursor signature is invalid.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch (error) {
      throw new Error('Sync cursor payload is invalid.', { cause: error });
    }
    const payload = cursorPayloadSchema.parse(parsed);
    if (
      payload.user_id !== expectedUserId ||
      payload.environment !== this.#environment
    ) {
      throw new Error('Sync cursor binding is invalid.');
    }
    return { sequence: payload.sequence };
  }

  async #key(): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      arrayBuffer(new TextEncoder().encode(this.#secret)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  }

  async #sign(body: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.sign('HMAC', await this.#key(), arrayBuffer(body)),
    );
  }

  async #verify(
    body: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> {
    return crypto.subtle.verify(
      'HMAC',
      await this.#key(),
      arrayBuffer(signature),
      arrayBuffer(body),
    );
  }
}
