import type { Client } from 'pg';

import {
  catalogImportDiffSchema,
  normalizedCatalogClassSectionSchema,
  normalizedCatalogCourseSchema,
  normalizedCatalogTermSchema,
} from '@ddl-tracker/contracts';

import type {
  CatalogImportApplyOutcome,
  CatalogImportApplyRepository,
} from './import-apply-service.js';
import { hashCatalogBaseline } from './import-diff.js';
import { loadCatalogBaseline } from './postgres-catalog-baseline.js';

interface ImportRow {
  id: string;
  normalized_term: unknown;
  total_batches: number;
  received_batches: number;
  applied_batches: number;
  baseline_hash: string | null;
  deactivation_count: number;
  diff: unknown;
  status: 'planned' | 'applied' | 'failed';
}

interface BatchRow {
  batch_index: number;
  payload: unknown;
  applied_at: Date | null;
}

interface ExistingCourseRow {
  id: string;
  name: string;
  credits: string | null;
  department: string | null;
  active: boolean;
  revision: number;
}

interface ExistingSectionRow {
  id: string;
  course_id: string;
  section_number: string;
  instructors: string[];
  campus: string | null;
  capacity: number | null;
  schedule_text: string | null;
  raw_source: Record<string, unknown>;
  active: boolean;
  revision: number;
}

interface ParsedBatch {
  batchIndex: number;
  appliedAt: Date | null;
  courses: ReturnType<typeof normalizedCatalogCourseSchema.parse>[];
  classSections: ReturnType<
    typeof normalizedCatalogClassSectionSchema.parse
  >[];
}

function parseBatch(row: BatchRow): ParsedBatch {
  if (typeof row.payload !== 'object' || row.payload === null) {
    throw new Error('Catalog import batch payload is invalid.');
  }
  const payload = row.payload as Record<string, unknown>;
  if (!Array.isArray(payload.courses) || !Array.isArray(payload.class_sections)) {
    throw new Error('Catalog import batch payload is incomplete.');
  }
  return {
    batchIndex: row.batch_index,
    appliedAt: row.applied_at,
    courses: payload.courses.map((course) =>
      normalizedCatalogCourseSchema.parse(course),
    ),
    classSections: payload.class_sections.map((section) =>
      normalizedCatalogClassSectionSchema.parse(section),
    ),
  };
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class PostgresCatalogImportApplyRepository
  implements CatalogImportApplyRepository
{
  readonly #client: Client;
  readonly #environment: string;

  constructor(client: Client, environment: string) {
    this.#client = client;
    this.#environment = environment;
  }

  async applyBatch(input: {
    actorId: string;
    importId: string;
    requestId: string;
    batchIndex: number;
    confirmDeactivations: boolean;
    now: Date;
    createId: () => string;
  }): Promise<CatalogImportApplyOutcome> {
    await this.#client.query('begin');
    try {
      const importResult = await this.#client.query<ImportRow>(
        `select id, normalized_term, total_batches, received_batches,
                applied_batches, baseline_hash, deactivation_count, diff,
                status
         from catalog_imports
         where id = $1 and environment = $2
         for update`,
        [input.importId, this.#environment],
      );
      const importRow = importResult.rows[0];
      if (importRow === undefined) {
        await this.#client.query('rollback');
        return { kind: 'not_found' };
      }

      const batchResult = await this.#client.query<BatchRow>(
        `select batch_index, payload, applied_at
         from catalog_import_batches
         where import_id = $1 and batch_index = $2
         for update`,
        [input.importId, input.batchIndex],
      );
      const batchRow = batchResult.rows[0];
      if (batchRow?.applied_at !== null && batchRow?.applied_at !== undefined) {
        await this.#client.query('commit');
        return {
          kind: 'replayed',
          appliedBatches: importRow.applied_batches,
          totalBatches: importRow.total_batches,
          complete: importRow.status === 'applied',
        };
      }

      if (
        batchRow === undefined ||
        importRow.status !== 'planned' ||
        importRow.diff === null ||
        importRow.baseline_hash === null ||
        importRow.received_batches !== importRow.total_batches
      ) {
        await this.#client.query('rollback');
        return { kind: 'plan_incomplete' };
      }
      if (input.batchIndex !== importRow.applied_batches) {
        await this.#client.query('rollback');
        return {
          kind: 'out_of_order',
          expectedBatchIndex: importRow.applied_batches,
        };
      }
      if (
        importRow.deactivation_count > 0 &&
        !input.confirmDeactivations
      ) {
        await this.#client.query('rollback');
        return {
          kind: 'deactivation_confirmation_required',
          count: importRow.deactivation_count,
        };
      }

      const term = normalizedCatalogTermSchema.parse(importRow.normalized_term);
      catalogImportDiffSchema.parse(importRow.diff);
      if (importRow.applied_batches === 0) {
        const baseline = await loadCatalogBaseline(
          this.#client,
          term.external_code,
        );
        if (hashCatalogBaseline(baseline) !== importRow.baseline_hash) {
          await this.#client.query('rollback');
          return { kind: 'baseline_changed' };
        }
      }

      const batch = parseBatch(batchRow);
      const termId = await this.#upsertTerm(
        term,
        input.importId,
        input.now,
        input.createId,
      );
      for (const course of batch.courses) {
        await this.#upsertCourse(
          termId,
          course,
          input.importId,
          input.now,
          input.createId,
        );
      }
      for (const section of batch.classSections) {
        const outcome = await this.#upsertSection(
          termId,
          section,
          input.importId,
          input.now,
          input.createId,
        );
        if (outcome === 'course_moved') {
          await this.#client.query('rollback');
          return { kind: 'baseline_changed' };
        }
      }

      const isFinal = input.batchIndex === importRow.total_batches - 1;
      if (isFinal) {
        await this.#deactivateMissing(
          termId,
          input.importId,
          input.now,
          input.createId,
        );
      }

      await this.#client.query(
        `update catalog_import_batches
         set applied_at = $3
         where import_id = $1 and batch_index = $2 and applied_at is null`,
        [input.importId, input.batchIndex, input.now],
      );
      const nextAppliedBatches = importRow.applied_batches + 1;
      await this.#client.query(
        `update catalog_imports
         set applied_batches = $2,
             status = case when $2 = total_batches then 'applied' else status end,
             applied_at = case when $2 = total_batches then $3 else applied_at end,
             updated_at = $3
         where id = $1`,
        [input.importId, nextAppliedBatches, input.now],
      );
      await this.#client.query(
        `insert into audit_log (
           id, actor_id, action, target_type, target_id, result,
           request_id, created_at
         ) values ($1, $2, 'catalog_import_batch_applied',
                   'catalog_import', $3, $4::jsonb, $5, $6)`,
        [
          input.createId(),
          input.actorId,
          input.importId,
          JSON.stringify({
            batch_index: input.batchIndex,
            applied_batches: nextAppliedBatches,
            total_batches: importRow.total_batches,
            complete: isFinal,
          }),
          input.requestId,
          input.now,
        ],
      );
      await this.#client.query('commit');
      return {
        kind: 'applied',
        appliedBatches: nextAppliedBatches,
        totalBatches: importRow.total_batches,
        complete: isFinal,
      };
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }

  async #upsertTerm(
    term: ReturnType<typeof normalizedCatalogTermSchema.parse>,
    importId: string,
    now: Date,
    createId: () => string,
  ): Promise<string> {
    const existing = await this.#client.query<{ id: string }>(
      `select id from academic_terms
       where external_term_code = $1
       for update`,
      [term.external_code],
    );
    const id = existing.rows[0]?.id ?? createId();
    if (existing.rows[0] === undefined) {
      await this.#client.query(
        `insert into academic_terms (
           id, external_term_code, name, starts_on, ends_on,
           source_metadata, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
        [
          id,
          term.external_code,
          term.display_name,
          term.starts_on,
          term.ends_on,
          JSON.stringify({ import_id: importId, time_zone: term.time_zone }),
          now,
        ],
      );
    } else {
      await this.#client.query(
        `update academic_terms
         set name = $2, starts_on = $3, ends_on = $4,
             source_metadata = $5::jsonb, updated_at = $6
         where id = $1`,
        [
          id,
          term.display_name,
          term.starts_on,
          term.ends_on,
          JSON.stringify({ import_id: importId, time_zone: term.time_zone }),
          now,
        ],
      );
    }
    return id;
  }

  async #upsertCourse(
    termId: string,
    course: ReturnType<typeof normalizedCatalogCourseSchema.parse>,
    importId: string,
    now: Date,
    createId: () => string,
  ): Promise<void> {
    const existing = await this.#client.query<ExistingCourseRow>(
      `select id, name, credits::text, department, active, revision
       from courses
       where term_id = $1 and external_course_code = $2
       for update`,
      [termId, course.external_course_code],
    );
    const current = existing.rows[0];
    const sourceMetadata = {
      import_id: importId,
      department_code: course.department_code,
      department_name: course.department_name,
    };
    if (current === undefined) {
      await this.#client.query(
        `insert into courses (
           id, term_id, external_course_code, name, credits, department,
           active, revision, source_metadata, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, true, 1, $7::jsonb, $8, $8)`,
        [
          createId(),
          termId,
          course.external_course_code,
          course.name,
          course.credits,
          course.department_name,
          JSON.stringify(sourceMetadata),
          now,
        ],
      );
      return;
    }
    const changed =
      current.name !== course.name ||
      current.credits !== course.credits ||
      current.department !== course.department_name ||
      !current.active;
    await this.#client.query(
      `update courses
       set name = $2, credits = $3, department = $4, active = true,
           revision = revision + $5,
           source_metadata = $6::jsonb, updated_at = $7
       where id = $1`,
      [
        current.id,
        course.name,
        course.credits,
        course.department_name,
        changed ? 1 : 0,
        JSON.stringify(sourceMetadata),
        now,
      ],
    );
  }

  async #upsertSection(
    termId: string,
    section: ReturnType<typeof normalizedCatalogClassSectionSchema.parse>,
    importId: string,
    now: Date,
    createId: () => string,
  ): Promise<'ok' | 'course_moved'> {
    const course = await this.#client.query<{ id: string }>(
      `select id from courses
       where term_id = $1 and external_course_code = $2
       limit 1`,
      [termId, section.external_course_code],
    );
    const courseId = course.rows[0]?.id;
    if (courseId === undefined) {
      throw new Error(
        `Catalog section references an unknown course: ${section.external_course_code}.`,
      );
    }
    const existing = await this.#client.query<ExistingSectionRow>(
      `select id, course_id, section_number, instructors, campus, capacity,
              schedule_text, raw_source, active, revision
       from class_sections
       where external_section_id = $1
       for update`,
      [section.external_section_id],
    );
    const current = existing.rows[0];
    if (current === undefined) {
      await this.#client.query(
        `insert into class_sections (
           id, course_id, external_section_id, section_number, instructors,
           campus, capacity, schedule_text, raw_source, active, revision,
           created_at, updated_at
         ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8,
                   $9::jsonb, true, 1, $10, $10)`,
        [
          createId(),
          courseId,
          section.external_section_id,
          section.section_number,
          JSON.stringify(section.instructors),
          section.campus_name,
          section.capacity,
          section.schedule_text,
          JSON.stringify({
            ...section.source_payload,
            import_id: importId,
            normalized_name: section.name,
            campus_code: section.campus_code,
          }),
          now,
        ],
      );
      return 'ok';
    }
    if (current.course_id !== courseId) {
      return 'course_moved';
    }
    const nextRawSource = {
      ...section.source_payload,
      import_id: importId,
      normalized_name: section.name,
      campus_code: section.campus_code,
    };
    const changed =
      current.section_number !== section.section_number ||
      !equalJson(current.instructors, section.instructors) ||
      current.campus !== section.campus_name ||
      current.capacity !== section.capacity ||
      current.schedule_text !== section.schedule_text ||
      !equalJson(current.raw_source, nextRawSource) ||
      !current.active;
    await this.#client.query(
      `update class_sections
       set section_number = $2, instructors = $3::jsonb, campus = $4,
           capacity = $5, schedule_text = $6, raw_source = $7::jsonb,
           active = true, revision = revision + $8, updated_at = $9
       where id = $1`,
      [
        current.id,
        section.section_number,
        JSON.stringify(section.instructors),
        section.campus_name,
        section.capacity,
        section.schedule_text,
        JSON.stringify(nextRawSource),
        changed ? 1 : 0,
        now,
      ],
    );
    return 'ok';
  }

  async #deactivateMissing(
    termId: string,
    importId: string,
    now: Date,
    createId: () => string,
  ): Promise<void> {
    const batches = await this.#client.query<BatchRow>(
      `select batch_index, payload, applied_at
       from catalog_import_batches
       where import_id = $1
       order by batch_index`,
      [importId],
    );
    const parsed = batches.rows.map(parseBatch);
    const desiredCourseCodes = parsed.flatMap((batch) =>
      batch.courses.map((course) => course.external_course_code),
    );
    const desiredSectionIds = parsed.flatMap((batch) =>
      batch.classSections.map((section) => section.external_section_id),
    );

    const deactivatedSections = await this.#client.query<{
      id: string;
      external_section_id: string;
      revision: number;
    }>(
      `update class_sections s
       set active = false, revision = s.revision + 1, updated_at = $3
       from courses c
       where s.course_id = c.id
         and c.term_id = $1
         and s.active = true
         and not (s.external_section_id = any($2::text[]))
       returning s.id, s.external_section_id, s.revision`,
      [termId, desiredSectionIds, now],
    );
    for (const section of deactivatedSections.rows) {
      await this.#client.query(
        `insert into sync_events (
           event_id, scope, type, schema_version, payload, occurred_at
         ) values ($1, 'authenticated_global',
                   'class_section_deactivated', 1, $2::jsonb, $3)`,
        [
          createId(),
          JSON.stringify({
            id: section.id,
            external_section_id: section.external_section_id,
            active: false,
            revision: section.revision,
          }),
          now,
        ],
      );
    }

    await this.#client.query(
      `update courses
       set active = false, revision = revision + 1, updated_at = $3
       where term_id = $1
         and active = true
         and not (external_course_code = any($2::text[]))`,
      [termId, desiredCourseCodes, now],
    );
  }
}
