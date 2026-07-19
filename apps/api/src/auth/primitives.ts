export type RandomBytes = (length: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

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

export function normalizeInstitutionalEmail(
  input: string,
  allowedDomains: readonly string[],
): { normalized: string; display: string } {
  const display = input.normalize('NFC').trim();
  const at = display.lastIndexOf('@');
  const local = display.slice(0, at);
  const domain = display.slice(at + 1).toLowerCase();
  const allowed = new Set(allowedDomains.map((value) => value.toLowerCase()));

  if (
    at <= 0 ||
    at !== display.indexOf('@') ||
    domain.length === 0 ||
    local.length > 254 ||
    /\s/u.test(display) ||
    !allowed.has(domain)
  ) {
    throw new Error('A valid institutional email is required.');
  }

  return {
    normalized: `${local.toLowerCase()}@${domain}`,
    display,
  };
}

export function createNumericCode(
  randomBytes: RandomBytes = defaultRandomBytes,
): string {
  const digits: number[] = [];
  while (digits.length < 6) {
    for (const byte of randomBytes(16)) {
      if (byte < 250) {
        digits.push(byte % 10);
        if (digits.length === 6) {
          break;
        }
      }
    }
  }
  return digits.join('');
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
