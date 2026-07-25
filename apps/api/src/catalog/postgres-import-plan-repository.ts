import type { Client } from 'pg';

import {
  catalogImportDiffSchema,
  normalizedCatalogClassSectionSchema,
  normalizedCatalogCourseSchema,
  normalizedCatalogTermSchema,
  type CatalogImportDiff,
  type CatalogImportStatusValue,
  type CatalogPlanBatchRequest,
} from '@ddl-tracker/contracts';

import { loadCatalogBaseline } from './postgres-catalog-baseline.js';
import type {
  CatalogImportBatchRecord,
  CatalogImportRecord,
  CatalogImportRepository,
  CatalogPlanningContext,
  SavePlanBatchOutcome,
} from './import-service.js';

interface ImportRow {
  id: string;
  actor_id: string | null;
  checksum: string;
  header_hash: string | null;
  manifest_hash: string | null;
  environment: string;
  filename: string;
  manifest: Record<string, unknown>;
  normalized_term: unknown;
  row_count: number;
  total_batches: number;
  received_batches: number;
  applied_batches: number;
  baseline_hash: string | null;
  deactivation_count: number;
  diff: unknown;
  status: CatalogImportStatusValue;
  failure_message: string | null;
}

interface BatchRow {
  batch_index: number;
  batch_checksum: string;
  payload: unknown;
  applied_at: Date | null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function toImportRecord(row: ImportRow): CatalogImportRecord {
  if (row.actor_id === null || row.header_hash === null || row.manifest_hash === null) {
    throw new Error('Catalog import metadata is incomplete.');
  }
  return {
    id: row.id,
    actorId: row.actor_id,
    checksum: row.checksum,
    headerHash: row.header_hash,
    manifestHash: row.manifest_hash,
    environment: row.environment,
    filename: row.filename,
    manifest: row.manifest,
    term: normalizedCatalogTermSchema.parse(row.normalized_term),
    rowCount: row.row_count,
    totalBatches: row.total_batches,
    receivedBatches: row.received_batches,
    appliedBatches: row.applied_batches,
    baselineHash: row.baseline_hash,
    deactivationCount: row.deactivation_count,
    diff: row.diff === null ? null : catalogImportDiffSchema.parse(row.diff),
    status: row.status,
    failureMessage: row.failure_message,
  };
}

function toBatchRecord(row: BatchRow): CatalogImportBatchRecord {
  if (typeof row.payload !== 'object' || row.payload === null) {
    throw new Error('Catalog import batch payload is invalid.');
  }
  const payload = row.payload as Record<string, unknown>;
  const courses = Array.isArray(payload.courses)
    ? payload.courses.map((course) => normalizedCatalogCourseSchema.parse(course))
    : null;
  const classSections = Array.isArray(payload.class_sections)
    ? payload.class_sections.map((section) =>
        normalizedCatalogClassSectionSchema.parse(section),
      )
    : null;
  if (courses === null || classSections === null) {
    throw new Error('Catalog import batch payload is incomplete.');
  }
  return {
    batchIndex: row.batch_index,
    batchChecksum: row.batch_checksum,
    courses,
    classSections,
    appliedAt: row.applied_at,
  };
}

function metadataMatches(
  record: CatalogImportRecord,
  actorId: string,
  request: CatalogPlanBatchRequest,
): boolean {
  return (
    record.actorId === actorId &&
    record.checksum === request.checksum &&
    record.headerHash === request.header_hash &&
    record.manifestHash === request.manifest_hash &&
    record.environment === request.environment &&
    record.filename === request.filename &&
    record.rowCount === request.row_count &&
    record.totalBatches === request.total_batches &&
    canonicalJson(record.manifest) === canonicalJson(request.manifest) &&
    canonicalJson(record.term) === canonicalJson(request.term) &&
    record.status === 'planned'
  );
}

export class PostgresCatalogImportRepository implements CatalogImportRepository {
  readonly #client: Client;
  readonly #environment: string;

  constructor(client: Client, environment: string) {
    this.#client = client;
    this.#environment = environment;
  }

  async savePlanBatch(input: {
    generatedImportId: string;
    actorId: string;
    request: CatalogPlanBatchRequest;
    batchChecksum: string;
    now: Date;
  }): Promise<SavePlanBatchOutcome> {
    if (input.request.environment !== this.#environment) {
      return { kind: 'metadata_conflict' };
    }
    const importId = input.request.import_id ?? input.generatedImportId;
    await this.#client.query('begin');
    try {
      if (input.request.import_id === null) {
        await this.#client.query(
          `insert into catalog_imports (
             id, checksum, header_hash, manifest_hash, environment, filename,
             manifest, normalized_term, row_count, total_batches,
             received_batches, applied_batches, diff, actor_id, status,
             created_at, updated_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10,
             0, 0, null, $11, 'planned', $12, $12
           )`,
          [
            importId,
            input.request.checksum,
            input.request.header_hash,
            input.request.manifest_hash,
            input.request.environment,
            input.request.filename,
            JSON.stringify(input.request.manifest),
            JSON.stringify(input.request.term),
            input.request.row_count,
            input.request.total_batches,
            input.actorId,
            input.now,
          ],
        );
      }

      const importResult = await this.#client.query<ImportRow>(
        `select id, actor_id, checksum, header_hash, manifest_hash,
                environment, filename, manifest, normalized_term, row_count,
                total_batches, received_batches, applied_batches,
                baseline_hash, deactivation_count, diff, status,
                failure_message
         from catalog_imports
         where id = $1 and environment = $2
         for update`,
        [importId, this.#environment],
      );
      const row = importResult.rows[0];
      if (row === undefined) {
        await this.#client.query('rollback');
        return { kind: 'metadata_conflict' };
      }
      const record = toImportRecord(row);
      if (!metadataMatches(record, input.actorId, input.request)) {
        await this.#client.query('rollback');
        return { kind: 'metadata_conflict' };
      }

      const existing = await this.#client.query<{
        batch_checksum: string;
      }>(
        `select batch_checksum
         from catalog_import_batches
         where import_id = $1 and batch_index = $2`,
        [importId, input.request.batch_index],
      );
      const existingChecksum = existing.rows[0]?.batch_checksum;
      if (existingChecksum !== undefined) {
        await this.#client.query('commit');
        return existingChecksum === input.batchChecksum
          ? { kind: 'replayed', importRecord: record }
          : { kind: 'batch_conflict' };
      }

      await this.#client.query(
        `insert into catalog_import_batches (
           import_id, batch_index, batch_checksum, payload, created_at
         ) values ($1, $2, $3, $4::jsonb, $5)`,
        [
          importId,
          input.request.batch_index,
          input.batchChecksum,
          JSON.stringify({
            courses: input.request.courses,
            class_sections: input.request.class_sections,
          }),
          input.now,
        ],
      );
      const updated = await this.#client.query<ImportRow>(
        `update catalog_imports
         set received_batches = received_batches + 1, updated_at = $2
         where id = $1
         returning id, actor_id, checksum, header_hash, manifest_hash,
                   environment, filename, manifest, normalized_term, row_count,
                   total_batches, received_batches, applied_batches,
                   baseline_hash, deactivation_count, diff, status,
                   failure_message`,
        [importId, input.now],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) {
        throw new Error('Catalog import disappeared while saving a batch.');
      }
      await this.#client.query('commit');
      return { kind: 'accepted', importRecord: toImportRecord(updatedRow) };
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }

  async loadPlanningContext(
    importId: string,
  ): Promise<CatalogPlanningContext | null> {
    const importResult = await this.#client.query<ImportRow>(
      `select id, actor_id, checksum, header_hash, manifest_hash,
              environment, filename, manifest, normalized_term, row_count,
              total_batches, received_batches, applied_batches,
              baseline_hash, deactivation_count, diff, status,
              failure_message
       from catalog_imports where id = $1 and environment = $2`,
      [importId, this.#environment],
    );
    const row = importResult.rows[0];
    if (row === undefined) {
      return null;
    }
    const importRecord = toImportRecord(row);
    const batchResult = await this.#client.query<BatchRow>(
      `select batch_index, batch_checksum, payload, applied_at
       from catalog_import_batches
       where import_id = $1
       order by batch_index`,
      [importId],
    );
    const baseline = await loadCatalogBaseline(
      this.#client,
      importRecord.term.external_code,
    );
    const prior = await this.#client.query(
      `select 1
       from catalog_imports
       where id <> $1
         and checksum = $2
         and manifest_hash = $3
         and environment = $4
         and status = 'applied'
       limit 1`,
      [
        importId,
        importRecord.checksum,
        importRecord.manifestHash,
        importRecord.environment,
      ],
    );
    return {
      importRecord,
      batches: batchResult.rows.map(toBatchRecord),
      baseline,
      checksumPreviouslyApplied: prior.rowCount === 1,
    };
  }

  async getStatus(importId: string): Promise<CatalogImportRecord | null> {
    const result = await this.#client.query<ImportRow>(
      `select id, actor_id, checksum, header_hash, manifest_hash,
              environment, filename, manifest, normalized_term, row_count,
              total_batches, received_batches, applied_batches,
              baseline_hash, deactivation_count, diff, status,
              failure_message
       from catalog_imports
       where id = $1 and environment = $2`,
      [importId, this.#environment],
    );
    const row = result.rows[0];
    return row === undefined ? null : toImportRecord(row);
  }

  async completePlan(
    importId: string,
    baselineHash: string,
    diff: CatalogImportDiff,
    now: Date,
  ): Promise<void> {
    const result = await this.#client.query(
      `update catalog_imports
       set baseline_hash = $2,
           diff = $3::jsonb,
           deactivation_count = $4,
           updated_at = $5
       where id = $1 and environment = $6
         and status = 'planned' and diff is null`,
      [
        importId,
        baselineHash,
        JSON.stringify(diff),
        diff.courses.deactivated + diff.class_sections.deactivated,
        now,
        this.#environment,
      ],
    );
    if (result.rowCount !== 1) {
      const existing = await this.#client.query<{
        baseline_hash: string | null;
        diff: unknown;
      }>(
        `select baseline_hash, diff
         from catalog_imports where id = $1 and environment = $2`,
        [importId, this.#environment],
      );
      const row = existing.rows[0];
      if (
        row?.baseline_hash !== baselineHash ||
        canonicalJson(row.diff) !== canonicalJson(diff)
      ) {
        throw new Error('Catalog import plan could not be finalized stably.');
      }
    }
  }

}
