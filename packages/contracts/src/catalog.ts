import { z } from 'zod';

import { normalizedTextSchema, uuidV7Schema } from './schema.js';

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Date must use YYYY-MM-DD.');

export const termStatusSchema = z.enum([
  'upcoming',
  'in_progress',
  'archived',
]);

export const termSchema = z
  .object({
    id: uuidV7Schema,
    external_code: z.string().min(1).max(100),
    name: normalizedTextSchema(1, 200),
    starts_on: localDateSchema.nullable(),
    ends_on: localDateSchema.nullable(),
    status: termStatusSchema,
  })
  .strict();

export const courseSchema = z
  .object({
    id: uuidV7Schema,
    external_course_code: z.string().min(1).max(100),
    name: normalizedTextSchema(1, 300),
    credits: z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/u).nullable(),
    department: normalizedTextSchema(1, 300).nullable(),
  })
  .strict();

export const classSectionSchema = z
  .object({
    id: uuidV7Schema,
    external_section_id: z.string().min(1).max(200),
    section_number: z.string().min(1).max(100),
    instructors: z.array(normalizedTextSchema(1, 200)).max(100),
    campus: normalizedTextSchema(1, 300).nullable(),
    capacity: z.number().int().nonnegative().nullable(),
    schedule_text: normalizedTextSchema(1, 2000).nullable(),
    active: z.boolean(),
    revision: z.number().int().positive(),
  })
  .strict();

export const termsResponseSchema = z
  .object({ terms: z.array(termSchema) })
  .strict();
export const coursesResponseSchema = z
  .object({ courses: z.array(courseSchema) })
  .strict();
export const classSectionsResponseSchema = z
  .object({ class_sections: z.array(classSectionSchema) })
  .strict();

export type TermStatus = z.infer<typeof termStatusSchema>;
export type TermWire = z.infer<typeof termSchema>;
export type CourseWire = z.infer<typeof courseSchema>;
export type ClassSectionWire = z.infer<typeof classSectionSchema>;
