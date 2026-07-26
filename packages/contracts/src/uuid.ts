import { ContractValidationError } from './validation.js';

export const UUID_V7_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UUID_V7 = new RegExp(UUID_V7_PATTERN, 'u');

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function parseUuidV7(value: string): string {
  if (!UUID_V7.test(value)) {
    throw new ContractValidationError(
      'Identifier must be a canonical lowercase UUIDv7.',
    );
  }

  return value;
}

export function createUuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const timestamp = BigInt(Date.now());

  for (let index = 0; index < 6; index += 1) {
    const shift = BigInt((5 - index) * 8);
    bytes[index] = Number((timestamp >> shift) & 0xffn);
  }

  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error('UUID byte buffer was unexpectedly short.');
  }

  bytes[6] = (versionByte & 0x0f) | 0x70;
  bytes[8] = (variantByte & 0x3f) | 0x80;

  return [
    toHex(bytes.slice(0, 4)),
    toHex(bytes.slice(4, 6)),
    toHex(bytes.slice(6, 8)),
    toHex(bytes.slice(8, 10)),
    toHex(bytes.slice(10, 16)),
  ].join('-');
}
