export type RandomBytes = (length: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createOpaqueSecret(
  randomBytes: RandomBytes = defaultRandomBytes,
): string {
  const bytes = randomBytes(32);
  if (bytes.byteLength !== 32) {
    throw new Error('Opaque secrets require exactly 32 random bytes.');
  }
  return encodeBase64Url(bytes);
}

export async function sha256(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

export async function hmacSha256(
  secret: string,
  payload: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export async function sealJson(
  secret: string,
  value: unknown,
  randomBytes: RandomBytes = defaultRandomBytes,
): Promise<string> {
  const iv = randomBytes(12);
  if (iv.byteLength !== 12) throw new Error('AES-GCM IV must contain 12 bytes.');
  const key = await importAesKey(secret, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openJson<T>(secret: string, sealed: string): Promise<T> {
  const [ivText, ciphertextText, extra] = sealed.split('.');
  if (ivText === undefined || ciphertextText === undefined || extra !== undefined) {
    throw new Error('Encrypted payload is malformed.');
  }
  const iv = decodeBase64Url(ivText);
  if (iv.byteLength !== 12) throw new Error('Encrypted payload IV is invalid.');
  const key = await importAesKey(secret, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(decodeBase64Url(ciphertextText)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function importAesKey(
  secret: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`ddl-tracker:oidc:${secret}`),
  );
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, usages);
}

export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
