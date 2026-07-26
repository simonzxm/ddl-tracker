import { z } from 'zod';

import {
  canonicalizeEvidenceUrl,
  canonicalizeTimestamp,
  countUnicodeScalars,
  normalizePlainText,
} from './validation.js';
import { parseUuidV7 } from './uuid.js';

function transformedString(
  parser: (value: string) => string,
): z.ZodPipe<z.ZodString, z.ZodTransform<string, string>> {
  return z.string().transform((value, context) => {
    try {
      return parser(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid value.',
      });
      return z.NEVER;
    }
  });
}

export const uuidV7Schema = transformedString(parseUuidV7);
export const rfc3339TimestampSchema = transformedString(canonicalizeTimestamp);
export const evidenceUrlSchema = transformedString(canonicalizeEvidenceUrl).meta({
  format: 'uri',
  maxLength: 2048,
});
export const opaqueTokenSchema = z.string().min(1).max(4096);
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Date must use YYYY-MM-DD.')
  .refine((value) => {
    const [yearText, monthText, dayText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (year < 1 || month < 1 || month > 12 || day < 1) {
      return false;
    }
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= (days[month - 1] ?? 0);
  }, 'Date must be a real Gregorian calendar date.');

export function normalizedTextSchema(minimum: number, maximum: number) {
  return z.string().transform((value, context) => {
    let normalized: string;
    try {
      normalized = normalizePlainText(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid text.',
      });
      return z.NEVER;
    }

    const length = countUnicodeScalars(normalized);
    if (length < minimum || length > maximum) {
      context.addIssue({
        code: 'custom',
        message: `Text must contain ${String(minimum)}-${String(maximum)} Unicode scalar values.`,
      });
      return z.NEVER;
    }

    return normalized;
  });
}

export function nullableNormalizedTextSchema(maximum: number) {
  return z.union([z.string(), z.null()]).transform((value, context) => {
    if (value === null) {
      return null;
    }

    let normalized: string;
    try {
      normalized = normalizePlainText(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid text.',
      });
      return z.NEVER;
    }

    if (normalized === '') {
      return null;
    }
    if (countUnicodeScalars(normalized) > maximum) {
      context.addIssue({
        code: 'custom',
        message: `Text must contain at most ${String(maximum)} Unicode scalar values.`,
      });
      return z.NEVER;
    }

    return normalized;
  });
}
