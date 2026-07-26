const RFC_3339_PRECISE_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const USERNAME = /^[a-z0-9_]{3,32}$/u;

export class ContractValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ContractValidationError';
  }
}

export function normalizePlainText(value: string): string {
  const normalized = value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .normalize('NFC')
    .trim();

  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    const isDisallowedControl =
      codePoint !== undefined &&
      (codePoint <= 0x08 ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f);

    if (isDisallowedControl) {
      throw new ContractValidationError(
        'Text contains a disallowed control character.',
      );
    }
  }

  return normalized;
}

export function countUnicodeScalars(value: string): number {
  return Array.from(value).length;
}

export function parseUsername(value: string): string {
  if (!USERNAME.test(value)) {
    throw new ContractValidationError(
      'Username must contain 3-32 lowercase ASCII letters, digits, or underscores.',
    );
  }

  return value;
}

export function parseDisplayName(value: string): string {
  const normalized = normalizePlainText(value);
  const length = countUnicodeScalars(normalized);

  if (length < 1 || length > 64) {
    throw new ContractValidationError(
      'Display name must contain 1-64 Unicode scalar values.',
    );
  }

  return normalized;
}

export function canonicalizeHttpsUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new ContractValidationError('Evidence URL must be an absolute URL.');
  }

  if (url.protocol !== 'https:') {
    throw new ContractValidationError('Evidence URL must use HTTPS.');
  }

  if (url.username !== '' || url.password !== '') {
    throw new ContractValidationError(
      'Evidence URL must not contain credentials.',
    );
  }

  url.hash = '';
  return url.toString();
}

export function canonicalizeEvidenceUrl(value: string): string {
  const canonical = canonicalizeHttpsUrl(value);
  if (new TextEncoder().encode(canonical).byteLength > 2048) {
    throw new ContractValidationError(
      'Evidence URL must contain at most 2048 UTF-8 bytes.',
    );
  }
  return canonical;
}

export function canonicalizeTimestamp(value: string): string {
  const trimmed = value.trim();
  if (!RFC_3339_PRECISE_TIMESTAMP.test(trimmed)) {
    throw new ContractValidationError(
      'Deadline must be a precise RFC 3339 timestamp.',
    );
  }

  const timestamp = new Date(trimmed);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new ContractValidationError('Deadline is not a valid timestamp.');
  }

  return timestamp.toISOString();
}
