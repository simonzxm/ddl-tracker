import { z } from 'zod';

import {
  normalizedTextSchema,
  nullableNormalizedTextSchema,
  rfc3339TimestampSchema,
  uuidV7Schema,
} from '../schema.js';

const revisionSchema = z.number().int().positive();
const nullableIdentifierTextSchema = z.string().min(1).max(300).nullable();

export const classSectionRecordSchema = z
  .object({
    id: uuidV7Schema,
    course_id: uuidV7Schema,
    external_section_id: z.string().min(1).max(200),
    section_number: z.string().min(1).max(100),
    department_code: z.string().min(1).max(100).nullable(),
    department_name: normalizedTextSchema(1, 300).nullable(),
    instructors: z.array(normalizedTextSchema(1, 200)).max(100),
    campus: normalizedTextSchema(1, 300).nullable(),
    capacity: z.number().int().nonnegative().nullable(),
    schedule_text: normalizedTextSchema(1, 2000).nullable(),
    active: z.boolean(),
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const courseTaskRecordSchema = z
  .object({
    id: uuidV7Schema,
    class_section_id: uuidV7Schema,
    created_by: uuidV7Schema.nullable(),
    state: z.literal('visible'),
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
    updated_at: rfc3339TimestampSchema,
  })
  .strict();

export const taskProposalRecordSchema = z
  .object({
    id: uuidV7Schema,
    course_task_id: uuidV7Schema,
    author_id: uuidV7Schema.nullable(),
    title: normalizedTextSchema(1, 200),
    deadline: rfc3339TimestampSchema,
    description: nullableNormalizedTextSchema(2000),
    evidence_note: nullableNormalizedTextSchema(500),
    evidence_url: nullableIdentifierTextSchema,
    content_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    state: z.literal('visible'),
    revision: revisionSchema,
    created_at: rfc3339TimestampSchema,
  })
  .strict();

export type ClassSectionRecord = z.infer<typeof classSectionRecordSchema>;
export type CourseTaskRecord = z.infer<typeof courseTaskRecordSchema>;
export type TaskProposalRecord = z.infer<typeof taskProposalRecordSchema>;
