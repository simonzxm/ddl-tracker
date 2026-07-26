import type { Client } from 'pg';

import {
  catalogImportDiffSchema,
  normalizedCatalogClassSectionSchema,
  normalizedCatalogCourseSchema,
  normalizedCatalogTermSchema,
  type CatalogImportStatusValue,
} from '@ddl-tracker/contracts';

import type {
  CatalogImportApplyOutcome,
  CatalogImportApplyRepository,
} from './import-apply-service.js';
import { hashCatalogBaseline } from './import-diff.js';
import { loadCatalogBaseline } from './postgres-catalog-baseline.js';
import { PostgresSyncEventStore } from '../sync/postgres-event-store.js';

interface ImportRow {
  id: string;
  normalized_term: unknown;
  total_batches: number;
  received_batches: number;
  applied_batches: number;
  baseline_hash: string | null;
  deactivation_count: number;
  diff: unknown;
  status: CatalogImportStatusValue;
}

interface BatchRow {
  batch_index: number;
  payload: unknown;
}

interface CourseIdentityRow {
  id: string;
  external_course_code: string;
}

interface SectionResolutionRow {
  external_section_id: string;
  external_course_code: string;
  course_id: string | null;
  section_id: string | null;
  existing_course_id: string | null;
}

interface ParsedBatch {
  batchIndex: number;
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
    courses: payload.courses.map((course) =>
      normalizedCatalogCourseSchema.parse(course),
    ),
    classSections: payload.class_sections.map((section) =>
      normalizedCatalogClassSectionSchema.parse(section),
    ),
  };
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

  async applyAll(input: {
    actorId: string;
    importId: string;
    requestId: string;
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
      if (importRow.status === 'applied') {
        await this.#client.query('commit');
        return {
          kind: 'replayed',
          appliedBatches: importRow.applied_batches,
          totalBatches: importRow.total_batches,
          complete: true,
        };
      }
      if (
        importRow.status !== 'planned' ||
        importRow.diff === null ||
        importRow.baseline_hash === null ||
        importRow.received_batches !== importRow.total_batches
      ) {
        await this.#client.query('rollback');
        return { kind: 'plan_incomplete' };
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

      const batchResult = await this.#client.query<BatchRow>(
        `select batch_index, payload
         from catalog_import_batches
         where import_id = $1
         order by batch_index
         for update`,
        [input.importId],
      );
      if (batchResult.rows.length !== importRow.total_batches) {
        await this.#client.query('rollback');
        return { kind: 'plan_incomplete' };
      }
      const batches = batchResult.rows.map(parseBatch);
      const courses = batches.flatMap((batch) => batch.courses);
      const classSections = batches.flatMap((batch) => batch.classSections);
      const termId = await this.#upsertTerm(
        term,
        input.importId,
        input.now,
        input.createId,
      );
      await this.#upsertCourses(
        termId,
        courses,
        input.importId,
        input.now,
        input.createId,
      );
      const sectionsApplied = await this.#upsertSections(
        termId,
        classSections,
        input.importId,
        input.now,
        input.createId,
      );
      if (!sectionsApplied) {
        await this.#client.query('rollback');
        return { kind: 'baseline_changed' };
      }
      await this.#deactivateMissing(
        termId,
        input.importId,
        input.now,
        input.createId,
      );
      await this.#advanceCatalogRevision(input.now, input.createId);

      await this.#client.query(
        `update catalog_import_batches
         set applied_at = coalesce(applied_at, $2)
         where import_id = $1`,
        [input.importId, input.now],
      );
      await this.#client.query(
        `update catalog_imports
         set applied_batches = total_batches, status = 'applied',
             applied_at = coalesce(applied_at, $2), updated_at = $2
         where id = $1`,
        [input.importId, input.now],
      );
      await this.#client.query(
        `insert into audit_log (
           id, actor_id, action, target_type, target_id, result,
           request_id, created_at
         ) values ($1, $2, 'catalog_import_applied',
                   'catalog_import', $3, $4::jsonb, $5, $6)`,
        [
          input.createId(),
          input.actorId,
          input.importId,
          JSON.stringify({
            previous_applied_batches: importRow.applied_batches,
            applied_batches: importRow.total_batches,
            total_batches: importRow.total_batches,
            complete: true,
          }),
          input.requestId,
          input.now,
        ],
      );
      await this.#client.query('commit');
      return {
        kind: 'applied',
        appliedBatches: importRow.total_batches,
        totalBatches: importRow.total_batches,
        complete: true,
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

  async #upsertCourses(
    termId: string,
    courses: ReturnType<typeof normalizedCatalogCourseSchema.parse>[],
    importId: string,
    now: Date,
    createId: () => string,
  ): Promise<void> {
    if (courses.length === 0) return;
    const existing = await this.#client.query<CourseIdentityRow>(
      `select id, external_course_code
       from courses
       where term_id = $1 and external_course_code = any($2::text[])
       for update`,
      [termId, courses.map((course) => course.external_course_code)],
    );
    const existingIds = new Map(
      existing.rows.map((course) => [course.external_course_code, course.id]),
    );
    const desired = courses.map((course) => ({
      id: existingIds.get(course.external_course_code) ?? createId(),
      external_course_code: course.external_course_code,
      name: course.name,
      credits: course.credits,
    }));
    await this.#client.query(
      `insert into courses as current (
         id, term_id, external_course_code, name, credits, active, revision,
         source_metadata, created_at, updated_at
       )
       select desired.id, $1, desired.external_course_code, desired.name,
              desired.credits, true, 1, $3::jsonb, $4, $4
       from jsonb_to_recordset($2::jsonb) as desired(
         id uuid, external_course_code text, name text, credits numeric
       )
       on conflict (term_id, external_course_code) do update
       set name = excluded.name,
           credits = excluded.credits,
           active = true,
           revision = current.revision + case
             when current.name is distinct from excluded.name
               or current.credits is distinct from excluded.credits
               or not current.active
             then 1 else 0 end,
           source_metadata = excluded.source_metadata,
           updated_at = excluded.updated_at`,
      [
        termId,
        JSON.stringify(desired),
        JSON.stringify({ import_id: importId }),
        now,
      ],
    );
  }

  async #upsertSections(
    termId: string,
    sections: ReturnType<typeof normalizedCatalogClassSectionSchema.parse>[],
    importId: string,
    now: Date,
    createId: () => string,
  ): Promise<boolean> {
    if (sections.length === 0) return true;
    const resolved = await this.#client.query<SectionResolutionRow>(
      `with desired as (
         select *
         from unnest($2::text[], $3::text[])
           as value(external_section_id, external_course_code)
       )
       select desired.external_section_id, desired.external_course_code,
              course.id as course_id, section.id as section_id,
              section.course_id as existing_course_id
       from desired
       left join courses course
         on course.term_id = $1
        and course.external_course_code = desired.external_course_code
       left join class_sections section
         on section.external_section_id = desired.external_section_id`,
      [
        termId,
        sections.map((section) => section.external_section_id),
        sections.map((section) => section.external_course_code),
      ],
    );
    const resolutions = new Map(
      resolved.rows.map((section) => [section.external_section_id, section]),
    );
    for (const section of sections) {
      const resolution = resolutions.get(section.external_section_id);
      if (resolution?.course_id === null || resolution === undefined) {
        throw new Error(
          `Catalog section references an unknown course: ${section.external_course_code}.`,
        );
      }
      if (
        resolution.existing_course_id !== null &&
        resolution.existing_course_id !== resolution.course_id
      ) {
        return false;
      }
    }

    const desired = sections.map((section) => {
      const resolution = resolutions.get(section.external_section_id);
      if (resolution?.course_id === null || resolution === undefined) {
        throw new Error('Catalog section resolution disappeared.');
      }
      return {
        id: resolution.section_id ?? createId(),
        course_id: resolution.course_id,
        external_section_id: section.external_section_id,
        section_number: section.section_number,
        department_code: section.department_code ?? null,
        department_name: section.department_name ?? null,
        instructors: section.instructors,
        campus: section.campus_name,
        capacity: section.capacity,
        schedule_text: section.schedule_text,
        raw_source: {
          ...section.source_payload,
          import_id: importId,
          normalized_name: section.name,
          campus_code: section.campus_code,
        },
      };
    });
    await this.#client.query(
      `insert into class_sections as current (
         id, course_id, external_section_id, section_number,
         department_code, department_name, instructors, campus, capacity,
         schedule_text, raw_source, active, revision, created_at, updated_at
       )
       select desired.id, desired.course_id, desired.external_section_id,
              desired.section_number, desired.department_code,
              desired.department_name, desired.instructors, desired.campus,
              desired.capacity, desired.schedule_text, desired.raw_source,
              true, 1, $2, $2
       from jsonb_to_recordset($1::jsonb) as desired(
         id uuid, course_id uuid, external_section_id text,
         section_number text, department_code text, department_name text,
         instructors jsonb, campus text, capacity integer,
         schedule_text text, raw_source jsonb
       )
       on conflict (external_section_id) do update
       set section_number = excluded.section_number,
           department_code = excluded.department_code,
           department_name = excluded.department_name,
           instructors = excluded.instructors,
           campus = excluded.campus,
           capacity = excluded.capacity,
           schedule_text = excluded.schedule_text,
           raw_source = excluded.raw_source,
           active = true,
           revision = current.revision + case
             when current.section_number is distinct from excluded.section_number
               or current.department_code is distinct from excluded.department_code
               or current.department_name is distinct from excluded.department_name
               or current.instructors is distinct from excluded.instructors
               or current.campus is distinct from excluded.campus
               or current.capacity is distinct from excluded.capacity
               or current.schedule_text is distinct from excluded.schedule_text
               or not current.active
             then 1 else 0 end,
           updated_at = excluded.updated_at`,
      [JSON.stringify(desired), now],
    );
    return true;
  }

  async #advanceCatalogRevision(
    now: Date,
    createId: () => string,
  ): Promise<void> {
    const result = await this.#client.query<{ revision: number }>(
      `update catalog_revision
       set revision = revision + 1, updated_at = $1
       where singleton_id = 1
       returning revision`,
      [now],
    );
    const revision = result.rows[0]?.revision;
    if (revision === undefined) {
      throw new Error('Catalog revision singleton is missing.');
    }
    const events = new PostgresSyncEventStore(this.#client, { createId });
    await events.append({
      scope: 'authenticated_global',
      occurredAt: now,
      event: {
        type: 'catalog_revision_changed',
        payload: {
          revision,
          updated_at: now.toISOString(),
        },
      },
    });
  }

  async #deactivateMissing(
    termId: string,
    importId: string,
    now: Date,
    createId: () => string,
  ): Promise<void> {
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
         and not exists (
           select 1
           from catalog_import_batches b
           cross join lateral
             jsonb_array_elements(b.payload->'class_sections') desired(value)
           where b.import_id = $2
             and desired.value->>'external_section_id' = s.external_section_id
         )
       returning s.id, s.external_section_id, s.revision`,
      [termId, importId, now],
    );
    const events = new PostgresSyncEventStore(this.#client, { createId });
    for (const section of deactivatedSections.rows) {
      await events.append({
        scope: 'authenticated_global',
        occurredAt: now,
        event: {
          type: 'class_section_deactivated',
          payload: {
            id: section.id,
            external_section_id: section.external_section_id,
            active: false,
            revision: section.revision,
            updated_at: now.toISOString(),
          },
        },
      });
    }

    await this.#client.query(
      `update courses
       set active = false, revision = revision + 1, updated_at = $3
       where term_id = $1
         and active = true
         and not exists (
           select 1
           from catalog_import_batches b
           cross join lateral
             jsonb_array_elements(b.payload->'courses') desired(value)
           where b.import_id = $2
             and desired.value->>'external_course_code' =
               courses.external_course_code
         )`,
      [termId, importId, now],
    );
  }
}
