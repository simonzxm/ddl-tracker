import { z } from 'zod';

import {
  normalizedTextSchema,
  nullableNormalizedTextSchema,
  uuidV7Schema,
} from './schema.js';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const decimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/u).nullable();
const optionalSourceText = z.string().max(10_000).nullable();

export const normalizedCatalogCourseSchema = z
  .object({
    external_course_code: z.string().trim().min(1).max(100),
    name: normalizedTextSchema(1, 300),
    credits: decimalSchema,
  })
  .strict();

export const normalizedCatalogClassSectionSchema = z
  .object({
    external_section_id: z.string().trim().min(1).max(200),
    external_course_code: z.string().trim().min(1).max(100),
    name: normalizedTextSchema(1, 300),
    section_number: z.string().trim().min(1).max(100),
    department_code: z.string().trim().min(1).max(100).nullable(),
    department_name: nullableNormalizedTextSchema(300),
    instructors: z.array(normalizedTextSchema(1, 200)).max(100),
    campus_code: z.string().trim().min(1).max(100).nullable(),
    campus_name: nullableNormalizedTextSchema(300),
    capacity: z.number().int().nonnegative().nullable(),
    schedule_text: nullableNormalizedTextSchema(2000),
    weeks_text: nullableNormalizedTextSchema(500),
    weekday_text: nullableNormalizedTextSchema(100),
    periods_text: nullableNormalizedTextSchema(100),
    room_text: nullableNormalizedTextSchema(300),
    building_code: z.string().trim().min(1).max(100).nullable(),
    building_name: nullableNormalizedTextSchema(300),
    source_payload: z.record(z.string().max(200), optionalSourceText),
  })
  .strict();

export const normalizedCatalogTermSchema = z
  .object({
    external_code: z.string().trim().min(1).max(100),
    display_name: normalizedTextSchema(1, 200),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    time_zone: z.literal('Asia/Shanghai'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.starts_on > value.ends_on) {
      context.addIssue({
        code: 'custom',
        path: ['ends_on'],
        message: 'Term end date must not precede its start date.',
      });
    }
  });

export const catalogPlanBatchRequestSchema = z
  .object({
    import_id: uuidV7Schema.nullable(),
    filename: normalizedTextSchema(1, 255),
    checksum: sha256Schema,
    header_hash: sha256Schema,
    manifest_hash: sha256Schema,
    environment: z.string().trim().min(1).max(100),
    manifest: z.record(z.string(), z.unknown()),
    term: normalizedCatalogTermSchema,
    row_count: z.number().int().nonnegative(),
    batch_index: z.number().int().nonnegative(),
    total_batches: z.number().int().min(1).max(1000),
    finalize: z.boolean(),
    courses: z.array(normalizedCatalogCourseSchema).max(500),
    class_sections: z.array(normalizedCatalogClassSectionSchema).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.batch_index >= value.total_batches) {
      context.addIssue({
        code: 'custom',
        path: ['batch_index'],
        message: 'Batch index must be below total batches.',
      });
    }
    if (value.batch_index > 0 && value.import_id === null) {
      context.addIssue({
        code: 'custom',
        path: ['import_id'],
        message: 'Subsequent plan batches require an import ID.',
      });
    }
    const isLast = value.batch_index === value.total_batches - 1;
    if (value.finalize !== isLast) {
      context.addIssue({
        code: 'custom',
        path: ['finalize'],
        message: 'Only the final plan batch may set finalize.',
      });
    }
  });

const diffCountsSchema = z
  .object({
    added: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    deactivated: z.number().int().nonnegative(),
  })
  .strict();

export const catalogImportDiffSchema = z
  .object({
    terms: diffCountsSchema,
    courses: diffCountsSchema,
    class_sections: diffCountsSchema,
    field_changes: z.record(z.string(), z.number().int().nonnegative()),
    deactivated_courses: z
      .array(
        z
          .object({
            id: uuidV7Schema,
            external_course_code: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .default([]),
    deactivated_class_sections: z
      .array(
        z
          .object({
            id: uuidV7Schema,
            external_section_id: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .default([]),
    deactivated_class_section_ids: z.array(uuidV7Schema),
    checksum_previously_applied: z.boolean(),
  })
  .strict();

export const catalogPlanBatchResponseSchema = z
  .object({
    import_id: uuidV7Schema,
    batch_index: z.number().int().nonnegative(),
    accepted: z.boolean(),
    received_batches: z.number().int().nonnegative(),
    total_batches: z.number().int().positive(),
    plan_complete: z.boolean(),
    diff: catalogImportDiffSchema.nullable(),
  })
  .strict();

export const catalogUploadResponseSchema = z
  .object({
    import_id: uuidV7Schema,
    replayed: z.boolean(),
    filename: normalizedTextSchema(1, 255),
    checksum: sha256Schema,
    manifest_hash: sha256Schema,
    row_count: z.number().int().nonnegative(),
    course_count: z.number().int().nonnegative(),
    class_section_count: z.number().int().nonnegative(),
    total_batches: z.number().int().positive(),
    warnings: z.array(z.string().max(500)).max(100),
    diff: catalogImportDiffSchema,
  })
  .strict();

export const catalogApplyAllRequestSchema = z
  .object({
    confirm_deactivations: z.boolean(),
  })
  .strict();

export const catalogApplyResponseSchema = z
  .object({
    import_id: uuidV7Schema,
    replayed: z.boolean(),
    applied_batches: z.number().int().nonnegative(),
    total_batches: z.number().int().positive(),
    complete: z.boolean(),
  })
  .strict();

export const catalogCancelRequestSchema = z
  .object({
    reason: normalizedTextSchema(1, 500),
  })
  .strict();

export const catalogCancelResponseSchema = z
  .object({
    import_id: uuidV7Schema,
    status: z.literal('cancelled'),
    replayed: z.boolean(),
  })
  .strict();

export const catalogImportStatusValueSchema = z.enum([
  'planned',
  'applied',
  'failed',
  'cancelled',
  'expired',
]);

export const catalogImportStatusSchema = z
  .object({
    import_id: uuidV7Schema,
    status: catalogImportStatusValueSchema,
    received_batches: z.number().int().nonnegative(),
    applied_batches: z.number().int().nonnegative(),
    total_batches: z.number().int().positive(),
    diff: catalogImportDiffSchema.nullable(),
    failure_message: z.string().nullable(),
  })
  .strict();

export type CatalogPlanBatchRequest = z.infer<
  typeof catalogPlanBatchRequestSchema
>;
export type CatalogImportDiff = z.infer<typeof catalogImportDiffSchema>;
export type CatalogApplyAllRequest = z.infer<
  typeof catalogApplyAllRequestSchema
>;
export type CatalogUploadResponse = z.infer<
  typeof catalogUploadResponseSchema
>;
export type CatalogCancelRequest = z.infer<typeof catalogCancelRequestSchema>;
export type CatalogCancelResponse = z.infer<typeof catalogCancelResponseSchema>;
export type CatalogImportStatusValue = z.infer<
  typeof catalogImportStatusValueSchema
>;
