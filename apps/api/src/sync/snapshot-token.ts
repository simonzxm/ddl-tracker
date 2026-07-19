import { z } from 'zod';

const SNAPSHOT_TTL_MS = 15 * 60 * 1000;

const snapshotPayloadSchema = z
  .object({
    version: z.literal(1),
    token_type: z.literal('snapshot'),
    snapshot_id: z.uuid(),
    kind: z.enum(['account', 'class_section']),
    user_id: z.uuid(),
    environment: z.string().min(1).max(100),
    class_section_id: z.uuid().nullable(),
    anchor_sequence: z.number().int().nonnegative(),
    expires_at: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.kind === 'account' && value.class_section_id !== null) ||
      (value.kind === 'class_section' && value.class_section_id === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['class_section_id'],
        message: 'Snapshot kind and class section binding do not match.',
      });
    }
  });

const pagePayloadSchema = z.object({
  version: z.literal(1),
  token_type: z.literal('page'),
  snapshot_id: z.uuid(),
  kind: z.enum(['account', 'class_section']),
  user_id: z.uuid(),
  environment: z.string().min(1).max(100),
  class_section_id: z.uuid().nullable(),
  anchor_sequence: z.number().int().nonnegative(),
  after_record_type: z.string().min(1).max(100),
  after_id: z.string().min(1).max(200),
  expires_at: z.number().int().positive(),
}).strict();

type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;
type PagePayload = z.infer<typeof pagePayloadSchema>;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Snapshot token is malformed.');
  }
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch (error) {
    throw new Error('Snapshot token is malformed.', { cause: error });
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export class SnapshotTokenCodec {
  readonly #secret: string;
  readonly #environment: string;

  constructor(secret: string, environment: string) {
    if (secret.length < 32) {
      throw new Error('Snapshot token secret must contain at least 32 characters.');
    }
    if (environment.length === 0) {
      throw new Error('Snapshot token environment is required.');
    }
    this.#secret = secret;
    this.#environment = environment;
  }

  createAccount(userId: string, anchorSequence: number, now: Date) {
    return this.#encodeSnapshot({
      snapshotId: crypto.randomUUID(),
      kind: 'account',
      userId,
      classSectionId: null,
      anchorSequence,
      now,
    });
  }

  createClassSection(
    userId: string,
    classSectionId: string,
    anchorSequence: number,
    now: Date,
  ) {
    return this.#encodeSnapshot({
      snapshotId: crypto.randomUUID(),
      kind: 'class_section',
      userId,
      classSectionId,
      anchorSequence,
      now,
    });
  }

  async renew(
    snapshotToken: string,
    expectedUserId: string,
    now: Date,
  ): Promise<string> {
    const snapshot = await this.decodeSnapshot(
      snapshotToken,
      expectedUserId,
      now,
    );
    return this.#encodeSnapshot({
      snapshotId: snapshot.snapshotId,
      kind: snapshot.kind,
      userId: expectedUserId,
      classSectionId: snapshot.classSectionId,
      anchorSequence: snapshot.anchorSequence,
      now,
    });
  }

  async createPage(
    snapshotToken: string,
    after: { recordType: string; id: string },
    now: Date,
  ): Promise<string> {
    const snapshot = await this.#decodeSignedSnapshot(snapshotToken);
    this.#assertNotExpired(snapshot.expires_at, now);
    return this.#encode({
      ...snapshot,
      token_type: 'page',
      expires_at: now.getTime() + SNAPSHOT_TTL_MS,
      after_record_type: after.recordType,
      after_id: after.id,
    });
  }

  async decodeSnapshot(
    token: string,
    expectedUserId: string,
    now: Date,
  ): Promise<{
    snapshotId: string;
    kind: 'account' | 'class_section';
    classSectionId: string | null;
    anchorSequence: number;
  }> {
    const payload = await this.#decodeSignedSnapshot(token);
    this.#assertBinding(payload, expectedUserId);
    this.#assertNotExpired(payload.expires_at, now);
    return {
      snapshotId: payload.snapshot_id,
      kind: payload.kind,
      classSectionId: payload.class_section_id,
      anchorSequence: payload.anchor_sequence,
    };
  }

  async decodePage(
    pageToken: string,
    snapshotToken: string,
    expectedUserId: string,
    now: Date,
  ): Promise<{ recordType: string; id: string }> {
    const [page, snapshot] = await Promise.all([
      this.#decodeSignedPage(pageToken),
      this.#decodeSignedSnapshot(snapshotToken),
    ]);
    this.#assertBinding(page, expectedUserId);
    this.#assertBinding(snapshot, expectedUserId);
    this.#assertNotExpired(page.expires_at, now);
    this.#assertNotExpired(snapshot.expires_at, now);
    if (
      page.snapshot_id !== snapshot.snapshot_id ||
      page.kind !== snapshot.kind ||
      page.class_section_id !== snapshot.class_section_id ||
      page.anchor_sequence !== snapshot.anchor_sequence
    ) {
      throw new Error('Page token does not belong to this snapshot.');
    }
    return {
      recordType: page.after_record_type,
      id: page.after_id,
    };
  }

  #assertBinding(
    payload: Pick<SnapshotPayload, 'user_id' | 'environment'>,
    expectedUserId: string,
  ): void {
    if (
      payload.user_id !== expectedUserId ||
      payload.environment !== this.#environment
    ) {
      throw new Error('Snapshot token binding is invalid.');
    }
  }

  #assertNotExpired(expiresAt: number, now: Date): void {
    if (now.getTime() > expiresAt) {
      throw new Error('Snapshot token has expired.');
    }
  }

  #encodeSnapshot(input: {
    snapshotId: string;
    kind: 'account' | 'class_section';
    userId: string;
    classSectionId: string | null;
    anchorSequence: number;
    now: Date;
  }): Promise<string> {
    return this.#encode(
      snapshotPayloadSchema.parse({
        version: 1,
        token_type: 'snapshot',
        snapshot_id: input.snapshotId,
        kind: input.kind,
        user_id: input.userId,
        environment: this.#environment,
        class_section_id: input.classSectionId,
        anchor_sequence: input.anchorSequence,
        expires_at: input.now.getTime() + SNAPSHOT_TTL_MS,
      }),
    );
  }

  async #encode(payload: SnapshotPayload | PagePayload): Promise<string> {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const signature = await crypto.subtle.sign(
      'HMAC',
      await this.#key(),
      arrayBuffer(body),
    );
    return `${bytesToBase64Url(body)}.${bytesToBase64Url(
      new Uint8Array(signature),
    )}`;
  }

  async #decodeSignedSnapshot(token: string): Promise<SnapshotPayload> {
    return snapshotPayloadSchema.parse(await this.#decode(token));
  }

  async #decodeSignedPage(token: string): Promise<PagePayload> {
    return pagePayloadSchema.parse(await this.#decode(token));
  }

  async #decode(token: string): Promise<unknown> {
    const parts = token.split('.');
    if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
      throw new Error('Snapshot token is malformed.');
    }
    const body = base64UrlToBytes(parts[0]);
    const signature = base64UrlToBytes(parts[1]);
    const valid = await crypto.subtle.verify(
      'HMAC',
      await this.#key(),
      arrayBuffer(signature),
      arrayBuffer(body),
    );
    if (!valid) {
      throw new Error('Snapshot token signature is invalid.');
    }
    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch (error) {
      throw new Error('Snapshot token payload is invalid.', { cause: error });
    }
  }

  #key(): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      arrayBuffer(new TextEncoder().encode(this.#secret)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  }
}
