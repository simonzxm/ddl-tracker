import { describe, expect, it } from 'vitest';
import { createUuidV7, parseUuidV7 } from '../src/uuid.js';

describe('UUIDv7 contracts', () => {
  it('creates canonical lowercase UUIDv7 identifiers', () => {
    const value = createUuidV7();

    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(parseUuidV7(value)).toBe(value);
  });

  it('rejects other UUID versions, uppercase forms, and malformed values', () => {
    expect(() =>
      parseUuidV7('550e8400-e29b-41d4-a716-446655440000'),
    ).toThrow();
    expect(() =>
      parseUuidV7('018F0000-0000-7000-8000-000000000000'),
    ).toThrow();
    expect(() => parseUuidV7('not-a-uuid')).toThrow();
  });
});
