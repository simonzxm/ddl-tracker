import { describe, expect, it } from 'vitest';
import {
  canonicalizeHttpsUrl,
  canonicalizeTimestamp,
  normalizePlainText,
  parseDisplayName,
  parseUsername,
} from '../src/validation.js';

describe('normalizePlainText', () => {
  it('normalizes Unicode, line endings, and surrounding whitespace', () => {
    expect(normalizePlainText('  Cafe\u0301\r\nline two  ')).toBe(
      'Café\nline two',
    );
  });

  it('rejects NUL and disallowed control characters', () => {
    expect(() => normalizePlainText('bad\u0000text')).toThrow('control');
    expect(() => normalizePlainText('bad\u0007text')).toThrow('control');
  });
});

describe('identity fields', () => {
  it('accepts only lowercase ASCII usernames with the documented length', () => {
    expect(parseUsername('student_01')).toBe('student_01');
    expect(() => parseUsername('Student')).toThrow();
    expect(() => parseUsername('ab')).toThrow();
  });

  it('counts display-name length by Unicode scalar values', () => {
    expect(parseDisplayName('同学😀')).toBe('同学😀');
    expect(() => parseDisplayName('😀'.repeat(65))).toThrow();
  });
});

describe('proposal scalar canonicalization', () => {
  it('accepts only credential-free HTTPS URLs and removes fragments', () => {
    expect(canonicalizeHttpsUrl(' HTTPS://Example.COM:443/a#section ')).toBe(
      'https://example.com/a',
    );
    expect(() => canonicalizeHttpsUrl('http://example.com')).toThrow();
    expect(() => canonicalizeHttpsUrl('https://u:p@example.com')).toThrow();
  });

  it('requires a precise RFC 3339 timestamp and canonicalizes it to UTC', () => {
    expect(canonicalizeTimestamp('2026-09-01T08:30:00+08:00')).toBe(
      '2026-09-01T00:30:00.000Z',
    );
    expect(() => canonicalizeTimestamp('2026-09-01')).toThrow();
  });
});
