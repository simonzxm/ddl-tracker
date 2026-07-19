import { z } from 'zod';

import { canonicalizeTimestamp } from './validation.js';
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
export const opaqueTokenSchema = z.string().min(1).max(4096);
