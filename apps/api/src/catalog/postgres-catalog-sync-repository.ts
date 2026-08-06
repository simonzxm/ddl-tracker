import type { Client } from 'pg';

import type {
  NormalizedCatalogClassSection,
  NormalizedCatalogCourse,
  NormalizedCatalogTerm,
} from '@ddl-tracker/catalog-sync';

import type {
  CatalogSyncApplyInput,
  CatalogSyncFailureInput,
  CatalogSyncRepository,
} from './catalog-sync-service.js';
import {
  buildCatalogDiff,
  hasCatalogChanges,
  type CatalogDiff,
} from './catalog-diff.js';
import { loadCatalogBaseline } from './postgres-catalog-baseline.js';
import { PostgresSyncEventStore } from '../sync/postgres-event-store.js';

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

export class PostgresCatalogSyncRepository implements CatalogSyncRepository {
  readonly #client: Client;
  readonly #createId: () => string;

  constructor(client: Client, options: { createId: () => string }) {
    this.#client = client;
    this.#createId = options.createId;
  }

  async currentSourceVersions(repository: string): Promise<Map<string, string>> {
    const result = await this.#client.query<{
      term_code: string;
      blob_sha: string;
    }>(
      `select term_code, blob_sha
       from catalog_sync_state
       where repository = $1
       order by term_code`,
      [repository],
    );
    return new Map(result.rows.map((row) => [row.term_code, row.blob_sha]));
  }

  async apply(input: CatalogSyncApplyInput): Promise<{ changed: boolean }> {
    await this.#client.query('begin');
    try {
      await this.#client.query('set transaction isolation level repeatable read');
      await this.#client.query(
        `select pg_advisory_xact_lock(
           hashtextextended($1, 0)
         )`,
        [`${input.repository}:${input.source.termCode}`],
      );

      const baseline = await loadCatalogBaseline(
        this.#client,
        input.catalog.term.external_code,
      );
      const desired = {
        term: input.catalog.term,
        courses: input.catalog.courses,
        classSections: input.catalog.class_sections,
      };
      const diff = buildCatalogDiff(desired, baseline);
      const changed = hasCatalogChanges(diff);

      const termId = await this.#upsertTerm(input.catalog.term, input);
      await this.#upsertCourses(termId, input.catalog.courses, input);
      await this.#upsertSections(termId, input.catalog.class_sections, input);
      await this.#deactivateMissing(
        termId,
        input.catalog.courses.map((course) => course.external_course_code),
        input.catalog.class_sections.map(
          (section) => section.external_section_id,
        ),
        input.completedAt,
      );
      if (changed) {
        await this.#advanceCatalogRevision(input.completedAt);
      }
      await this.#recordSuccess(input, diff, changed);
      await this.#upsertState(input);

      await this.#client.query('commit');
      return { changed };
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }

  async recordFailure(input: CatalogSyncFailureInput): Promise<void> {
    await this.#client.query(
      `insert into catalog_sync_runs (
         id, repository, commit_sha, term_code, source_path, blob_sha,
         status, error_message, started_at, completed_at
       ) values ($1, $2, $3, $4, $5, $6, 'failed', $7, $8, $9)`,
      [
        input.runId,
        input.repository,
        input.commitSha,
        input.source.termCode,
        input.source.path,
        input.source.sourceVersion,
        input.errorMessage,
        input.startedAt,
        input.completedAt,
      ],
    );
  }

  async #upsertTerm(
    term: NormalizedCatalogTerm,
    input: CatalogSyncApplyInput,
  ): Promise<string> {
    const existing = await this.#client.query<{ id: string }>(
      `select id
       from academic_terms
       where external_term_code = $1
       for update`,
      [term.external_code],
    );
    const id = existing.rows[0]?.id ?? this.#createId();
    const metadata = JSON.stringify(sourceMetadata(input, {
      time_zone: term.time_zone,
    }));
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
          metadata,
          input.completedAt,
        ],
      );
    } else {
      await this.#client.query(
        `update academic_terms
         set name = $2,
             starts_on = coalesce($3, starts_on),
             ends_on = coalesce($4, ends_on),
             source_metadata = $5::jsonb,
             updated_at = $6
         where id = $1`,
        [
          id,
          term.display_name,
          term.starts_on,
          term.ends_on,
          metadata,
          input.completedAt,
        ],
      );
    }
    return id;
  }

  async #upsertCourses(
    termId: string,
    courses: NormalizedCatalogCourse[],
    input: CatalogSyncApplyInput,
  ): Promise<void> {
    if (courses.length === 0) return;
    const existing = await this.#client.query<CourseIdentityRow>(
      `select id, external_course_code
       from courses
       where term_id = $1
         and external_course_code = any($2::text[])
       for update`,
      [termId, courses.map((course) => course.external_course_code)],
    );
    const existingIds = new Map(
      existing.rows.map((course) => [course.external_course_code, course.id]),
    );
    const desired = courses.map((course) => ({
      id: existingIds.get(course.external_course_code) ?? this.#createId(),
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
        JSON.stringify(sourceMetadata(input)),
        input.completedAt,
      ],
    );
  }

  async #upsertSections(
    termId: string,
    sections: NormalizedCatalogClassSection[],
    input: CatalogSyncApplyInput,
  ): Promise<void> {
    if (sections.length === 0) return;
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
        throw new Error(
          `Class section ${section.external_section_id} cannot move between courses.`,
        );
      }
    }

    const desired = sections.map((section) => {
      const resolution = resolutions.get(section.external_section_id);
      if (resolution?.course_id === null || resolution === undefined) {
        throw new Error('Catalog section resolution disappeared.');
      }
      return {
        id: resolution.section_id ?? this.#createId(),
        course_id: resolution.course_id,
        external_section_id: section.external_section_id,
        section_number: section.section_number,
        department_code: section.department_code,
        department_name: section.department_name,
        instructors: section.instructors,
        campus: section.campus_name,
        capacity: section.capacity,
        schedule_text: section.schedule_text,
        raw_source: {
          ...section.source_payload,
          sync: sourceMetadata(input, {
            normalized_name: section.name,
            campus_code: section.campus_code,
          }),
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
      [JSON.stringify(desired), input.completedAt],
    );
  }

  async #deactivateMissing(
    termId: string,
    courseCodes: string[],
    sectionIds: string[],
    now: Date,
  ): Promise<void> {
    const deactivatedSections = await this.#client.query<{
      id: string;
      external_section_id: string;
      revision: number;
    }>(
      `update class_sections section
       set active = false,
           revision = section.revision + 1,
           updated_at = $3
       from courses course
       where section.course_id = course.id
         and course.term_id = $1
         and section.active = true
         and not (section.external_section_id = any($2::text[]))
       returning section.id, section.external_section_id, section.revision`,
      [termId, sectionIds, now],
    );
    const events = new PostgresSyncEventStore(this.#client, {
      createId: this.#createId,
    });
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
       set active = false,
           revision = revision + 1,
           updated_at = $3
       where term_id = $1
         and active = true
         and not (external_course_code = any($2::text[]))`,
      [termId, courseCodes, now],
    );
  }

  async #advanceCatalogRevision(now: Date): Promise<void> {
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
    const events = new PostgresSyncEventStore(this.#client, {
      createId: this.#createId,
    });
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

  async #recordSuccess(
    input: CatalogSyncApplyInput,
    diff: CatalogDiff,
    changed: boolean,
  ): Promise<void> {
    await this.#client.query(
      `insert into catalog_sync_runs (
         id, repository, commit_sha, term_code, source_path, blob_sha,
         source_checksum, row_count, course_count, class_section_count,
         changed, diff, status, started_at, completed_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12::jsonb, 'succeeded', $13, $14
       )`,
      [
        input.runId,
        input.repository,
        input.commitSha,
        input.source.termCode,
        input.source.path,
        input.source.sourceVersion,
        input.catalog.metadata.checksum,
        input.catalog.metadata.row_count,
        input.catalog.courses.length,
        input.catalog.class_sections.length,
        changed,
        JSON.stringify(diff),
        input.startedAt,
        input.completedAt,
      ],
    );
  }

  async #upsertState(input: CatalogSyncApplyInput): Promise<void> {
    await this.#client.query(
      `insert into catalog_sync_state as current (
         repository, term_code, commit_sha, blob_sha, source_checksum,
         synced_at, run_id
       ) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (repository, term_code) do update
       set commit_sha = excluded.commit_sha,
           blob_sha = excluded.blob_sha,
           source_checksum = excluded.source_checksum,
           synced_at = excluded.synced_at,
           run_id = excluded.run_id`,
      [
        input.repository,
        input.source.termCode,
        input.commitSha,
        input.source.sourceVersion,
        input.catalog.metadata.checksum,
        input.completedAt,
        input.runId,
      ],
    );
  }
}

function sourceMetadata(
  input: CatalogSyncApplyInput,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source_system: 'github',
    repository: input.repository,
    commit_sha: input.commitSha,
    source_version: input.source.sourceVersion,
    source_path: input.source.path,
    sync_run_id: input.runId,
    source_checksum: input.catalog.metadata.checksum,
    ...extra,
  };
}
