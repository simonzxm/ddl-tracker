import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const termStatusOverride = pgEnum('term_status_override', [
  'active',
  'archived',
]);

export const academicTerms = pgTable(
  'academic_terms',
  {
    id: uuid('id').primaryKey(),
    externalTermCode: text('external_term_code').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    statusOverride: termStatusOverride('status_override'),
    sourceMetadata: jsonb('source_metadata')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('academic_terms_external_code_unique').on(
      table.externalTermCode,
    ),
    check(
      'academic_terms_date_order',
      sql`${table.startsOn} is null or ${table.endsOn} is null or ${table.startsOn} <= ${table.endsOn}`,
    ),
  ],
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey(),
    termId: uuid('term_id')
      .notNull()
      .references(() => academicTerms.id, { onDelete: 'restrict' }),
    externalCourseCode: text('external_course_code').notNull(),
    name: text('name').notNull(),
    credits: numeric('credits', { precision: 5, scale: 2 }),
    department: text('department'),
    sourceMetadata: jsonb('source_metadata')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('courses_term_external_code_unique').on(
      table.termId,
      table.externalCourseCode,
    ),
    index('courses_term_idx').on(table.termId),
  ],
);

export const classSections = pgTable(
  'class_sections',
  {
    id: uuid('id').primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    externalSectionId: text('external_section_id').notNull(),
    sectionNumber: text('section_number').notNull(),
    instructors: jsonb('instructors')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    campus: text('campus'),
    capacity: integer('capacity'),
    scheduleText: text('schedule_text'),
    rawSource: jsonb('raw_source')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    active: boolean('active').default(true).notNull(),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('class_sections_external_id_unique').on(
      table.externalSectionId,
    ),
    index('class_sections_course_idx').on(table.courseId),
    check(
      'class_sections_capacity_nonnegative',
      sql`${table.capacity} is null or ${table.capacity} >= 0`,
    ),
    check('class_sections_revision_positive', sql`${table.revision} > 0`),
  ],
);
