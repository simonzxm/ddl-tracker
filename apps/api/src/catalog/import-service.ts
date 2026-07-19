import { createHash } from 'node:crypto';

import {
  createUuidV7,
  type CatalogImportDiff,
  type CatalogPlanBatchRequest,
} from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';
import {
  buildCatalogImportDiff,
  hashCatalogBaseline,
  type CatalogBaseline,
} from './import-diff.js';

export interface CatalogImportRecord {
  id: string;
  actorId: string;
  checksum: string;
  headerHash: string;
  manifestHash: string;
  environment: string;
  filename: string;
  manifest: Record<string, unknown>;
  term: CatalogPlanBatchRequest['term'];
  rowCount: number;
  totalBatches: number;
  receivedBatches: number;
  appliedBatches: number;
  baselineHash: string | null;
  deactivationCount: number;
  diff: CatalogImportDiff | null;
  status: 'planned' | 'applied' | 'failed';
  failureMessage: string | null;
}

export interface CatalogImportBatchRecord {
  batchIndex: number;
  batchChecksum: string;
  courses: CatalogPlanBatchRequest['courses'];
  classSections: CatalogPlanBatchRequest['class_sections'];
  appliedAt: Date | null;
}

export interface CatalogPlanningContext {
  importRecord: CatalogImportRecord;
  batches: CatalogImportBatchRecord[];
  baseline: CatalogBaseline;
  checksumPreviouslyApplied: boolean;
}

export type SavePlanBatchOutcome =
  | {
      kind: 'accepted' | 'replayed';
      importRecord: CatalogImportRecord;
    }
  | { kind: 'metadata_conflict' }
  | { kind: 'batch_conflict' };

export interface CatalogImportRepository {
  savePlanBatch(input: {
    generatedImportId: string;
    actorId: string;
    request: CatalogPlanBatchRequest;
    batchChecksum: string;
    now: Date;
  }): Promise<SavePlanBatchOutcome>;
  loadPlanningContext(importId: string): Promise<CatalogPlanningContext | null>;
  completePlan(
    importId: string,
    baselineHash: string,
    diff: CatalogImportDiff,
    now: Date,
  ): Promise<void>;
}

export interface CatalogPlanBatchResponse {
  import_id: string;
  batch_index: number;
  accepted: boolean;
  received_batches: number;
  total_batches: number;
  plan_complete: boolean;
  diff: CatalogImportDiff | null;
}

function checksumBatch(request: CatalogPlanBatchRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        batch_index: request.batch_index,
        courses: request.courses,
        class_sections: request.class_sections,
      }),
      'utf8',
    )
    .digest('hex');
}

function orderedBatches(
  batches: readonly CatalogImportBatchRecord[],
  totalBatches: number,
): CatalogImportBatchRecord[] {
  const ordered = [...batches].sort(
    (left, right) => left.batchIndex - right.batchIndex,
  );
  if (ordered.length !== totalBatches) {
    throw new HttpError({
      code: 'conflict',
      message: 'Not all catalog plan batches have been uploaded.',
      status: 409,
    });
  }
  ordered.forEach((batch, index) => {
    if (batch.batchIndex !== index) {
      throw new HttpError({
        code: 'conflict',
        message: 'Catalog plan batches are not contiguous.',
        status: 409,
      });
    }
  });
  return ordered;
}

export class CatalogImportService {
  readonly #repository: CatalogImportRepository;
  readonly #createId: () => string;
  readonly #now: () => Date;

  constructor(options: {
    repository: CatalogImportRepository;
    createId?: () => string;
    now?: () => Date;
  }) {
    this.#repository = options.repository;
    this.#createId = options.createId ?? createUuidV7;
    this.#now = options.now ?? (() => new Date());
  }

  async planBatch(
    actorId: string,
    request: CatalogPlanBatchRequest,
  ): Promise<CatalogPlanBatchResponse> {
    const saved = await this.#repository.savePlanBatch({
      generatedImportId: this.#createId(),
      actorId,
      request,
      batchChecksum: checksumBatch(request),
      now: this.#now(),
    });
    if (saved.kind === 'metadata_conflict') {
      throw new HttpError({
        code: 'conflict',
        message: 'Catalog import metadata does not match the existing plan.',
        status: 409,
      });
    }
    if (saved.kind === 'batch_conflict') {
      throw new HttpError({
        code: 'operation_id_reused',
        message: 'Catalog batch index was reused with different content.',
        status: 409,
      });
    }

    let record = saved.importRecord;
    if (record.diff === null && record.receivedBatches === record.totalBatches) {
      const context = await this.#repository.loadPlanningContext(record.id);
      if (context === null) {
        throw new HttpError({
          code: 'not_found',
          message: 'Catalog import plan not found.',
          status: 404,
        });
      }
      const batches = orderedBatches(context.batches, record.totalBatches);
      const courses = batches.flatMap((batch) => batch.courses);
      const classSections = batches.flatMap((batch) => batch.classSections);
      if (classSections.length !== record.rowCount) {
        throw new HttpError({
          code: 'invalid_request',
          message: 'Uploaded class section count does not match row_count.',
          status: 400,
          details: {
            expected_row_count: record.rowCount,
            actual_row_count: classSections.length,
          },
        });
      }
      let diff: CatalogImportDiff;
      try {
        diff = buildCatalogImportDiff(
          { term: record.term, courses, classSections },
          context.baseline,
          context.checksumPreviouslyApplied,
        );
      } catch (error) {
        throw new HttpError({
          code: 'invalid_request',
          message:
            error instanceof Error
              ? error.message
              : 'Catalog import could not be planned.',
          status: 400,
        });
      }
      const baselineHash = hashCatalogBaseline(context.baseline);
      await this.#repository.completePlan(
        record.id,
        baselineHash,
        diff,
        this.#now(),
      );
      record = {
        ...record,
        baselineHash,
        diff,
        deactivationCount:
          diff.courses.deactivated + diff.class_sections.deactivated,
      };
    }

    return {
      import_id: record.id,
      batch_index: request.batch_index,
      accepted: saved.kind === 'accepted',
      received_batches: record.receivedBatches,
      total_batches: record.totalBatches,
      plan_complete: record.diff !== null,
      diff: record.diff,
    };
  }
}
