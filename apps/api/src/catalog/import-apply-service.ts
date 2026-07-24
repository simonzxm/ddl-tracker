import {
  createUuidV7,
  type CatalogApplyAllRequest,
} from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';

export type CatalogImportApplyOutcome =
  | {
      kind: 'applied' | 'replayed';
      appliedBatches: number;
      totalBatches: number;
      complete: boolean;
    }
  | { kind: 'not_found' }
  | { kind: 'plan_incomplete' }
  | { kind: 'baseline_changed' }
  | { kind: 'deactivation_confirmation_required'; count: number };

export interface CatalogImportApplyRepository {
  applyAll(input: {
    actorId: string;
    importId: string;
    requestId: string;
    confirmDeactivations: boolean;
    now: Date;
    createId: () => string;
  }): Promise<CatalogImportApplyOutcome>;
}

export interface CatalogApplyResponse {
  import_id: string;
  replayed: boolean;
  applied_batches: number;
  total_batches: number;
  complete: boolean;
}

export class CatalogImportApplyService {
  readonly #repository: CatalogImportApplyRepository;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: {
    repository: CatalogImportApplyRepository;
    now?: () => Date;
    createId?: () => string;
  }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? createUuidV7;
  }

  async applyAll(
    actorId: string,
    importId: string,
    requestId: string,
    request: CatalogApplyAllRequest,
  ): Promise<CatalogApplyResponse> {
    const outcome = await this.#repository.applyAll({
      actorId,
      importId,
      requestId,
      confirmDeactivations: request.confirm_deactivations,
      now: this.#now(),
      createId: this.#createId,
    });
    return this.#response(importId, outcome);
  }

  #response(
    importId: string,
    outcome: CatalogImportApplyOutcome,
  ): CatalogApplyResponse {

    if (outcome.kind === 'not_found') {
      throw new HttpError({
        code: 'not_found',
        message: 'Catalog import plan not found.',
        status: 404,
      });
    }
    if (outcome.kind === 'plan_incomplete') {
      throw new HttpError({
        code: 'conflict',
        message: 'Catalog import plan is not complete.',
        status: 409,
      });
    }
    if (outcome.kind === 'baseline_changed') {
      throw new HttpError({
        code: 'revision_conflict',
        message: 'Catalog changed after the import plan was created.',
        status: 409,
      });
    }
    if (outcome.kind === 'deactivation_confirmation_required') {
      throw new HttpError({
        code: 'conflict',
        message: 'Catalog deactivations require explicit confirmation.',
        status: 409,
        details: { deactivation_count: outcome.count },
      });
    }
    return {
      import_id: importId,
      replayed: outcome.kind === 'replayed',
      applied_batches: outcome.appliedBatches,
      total_batches: outcome.totalBatches,
      complete: outcome.complete,
    };
  }
}
