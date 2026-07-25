import { createHash } from 'node:crypto';

import { localDateSchema, normalizePlainText } from '@ddl-tracker/contracts';
import { z } from 'zod';
const normalizedText = (maximum: number) =>
  z.string().transform((value, context) => {
    try {
      const normalized = normalizePlainText(value);
      if (normalized.length === 0 || Array.from(normalized).length > maximum) {
        context.addIssue({
          code: 'custom',
          message: `Text must contain 1-${String(maximum)} Unicode scalar values.`,
        });
        return z.NEVER;
      }
      return normalized;
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid text.',
      });
      return z.NEVER;
    }
  });

const catalogManifestSchema = z
  .object({
    schema_version: z.literal(1),
    source_system: normalizedText(100),
    term: z
      .object({
        external_code: z.string().trim().min(1).max(100),
        display_name: normalizedText(200),
        display_name_override_reason: normalizedText(500).optional(),
        starts_on: localDateSchema,
        ends_on: localDateSchema,
        time_zone: z.literal('Asia/Shanghai'),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.term.starts_on > value.term.ends_on) {
      context.addIssue({
        code: 'custom',
        path: ['term', 'ends_on'],
        message: 'Term end date must not be before its start date.',
      });
    }
  });

export type CatalogManifest = z.infer<typeof catalogManifestSchema>;

export function parseCatalogManifest(value: unknown): CatalogManifest {
  return catalogManifestSchema.parse(value);
}

export function hashCatalogManifest(manifest: CatalogManifest): string {
  const canonical = JSON.stringify({
    schema_version: manifest.schema_version,
    source_system: manifest.source_system,
    term: {
      external_code: manifest.term.external_code,
      display_name: manifest.term.display_name,
      ...(manifest.term.display_name_override_reason === undefined
        ? {}
        : {
            display_name_override_reason:
              manifest.term.display_name_override_reason,
          }),
      starts_on: manifest.term.starts_on,
      ends_on: manifest.term.ends_on,
      time_zone: manifest.term.time_zone,
    },
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
