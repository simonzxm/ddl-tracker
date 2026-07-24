import { describe, expect, it } from 'vitest';

import {
  CatalogImportApplyService,
  type CatalogImportApplyRepository,
  type CatalogImportApplyOutcome,
} from '../src/catalog/import-apply-service.js';

const ACTOR_ID = '018f0000-0000-7000-8000-000000000701';
const IMPORT_ID = '018f0000-0000-7000-8000-000000000702';
const REQUEST_ID = '018f0000-0000-7000-8000-000000000703';
const NOW = new Date('2026-07-19T12:00:00.000Z');

class FakeApplyRepository implements CatalogImportApplyRepository {
  outcome: CatalogImportApplyOutcome = {
    kind: 'applied',
    appliedBatches: 1,
    totalBatches: 2,
    complete: false,
  };
  received: Parameters<CatalogImportApplyRepository['applyBatch']>[0] | null = null;
  receivedAll: Parameters<CatalogImportApplyRepository['applyAll']>[0] | null = null;

  applyBatch(input: Parameters<CatalogImportApplyRepository['applyBatch']>[0]) {
    this.received = input;
    return Promise.resolve(this.outcome);
  }

  applyAll(input: Parameters<CatalogImportApplyRepository['applyAll']>[0]) {
    this.receivedAll = input;
    return Promise.resolve(this.outcome);
  }
}

function service(repository: FakeApplyRepository): CatalogImportApplyService {
  let counter = 0;
  return new CatalogImportApplyService({
    repository,
    now: () => NOW,
    createId: () => {
      counter += 1;
      return `018f0000-0000-7000-8000-${String(counter).padStart(12, '0')}`;
    },
  });
}

describe('CatalogImportApplyService', () => {
  it('applies the complete import without a client batch index', async () => {
    const repository = new FakeApplyRepository();
    repository.outcome = {
      kind: 'applied',
      appliedBatches: 2,
      totalBatches: 2,
      complete: true,
    };

    const response = await service(repository).applyAll(
      ACTOR_ID,
      IMPORT_ID,
      REQUEST_ID,
      { confirm_deactivations: true },
    );

    expect(response).toMatchObject({
      batch_index: 1,
      applied_batches: 2,
      total_batches: 2,
      complete: true,
    });
    expect(repository.receivedAll).toMatchObject({
      actorId: ACTOR_ID,
      importId: IMPORT_ID,
      requestId: REQUEST_ID,
      confirmDeactivations: true,
      now: NOW,
    });
  });

  it('applies a requested batch with an ID factory and returns progress', async () => {
    const repository = new FakeApplyRepository();

    const response = await service(repository).applyBatch(ACTOR_ID, IMPORT_ID, REQUEST_ID, {
      batch_index: 0,
      confirm_deactivations: false,
    });

    expect(response).toEqual({
      import_id: IMPORT_ID,
      batch_index: 0,
      replayed: false,
      applied_batches: 1,
      total_batches: 2,
      complete: false,
    });
    expect(repository.received).toMatchObject({
      actorId: ACTOR_ID,
      importId: IMPORT_ID,
      requestId: REQUEST_ID,
      batchIndex: 0,
      confirmDeactivations: false,
      now: NOW,
    });
    expect(repository.received?.createId()).toMatch(/^018f/u);
  });

  it('returns stable progress for a replayed batch', async () => {
    const repository = new FakeApplyRepository();
    repository.outcome = {
      kind: 'replayed',
      appliedBatches: 2,
      totalBatches: 2,
      complete: true,
    };

    await expect(
      service(repository).applyBatch(ACTOR_ID, IMPORT_ID, REQUEST_ID, {
        batch_index: 1,
        confirm_deactivations: true,
      }),
    ).resolves.toMatchObject({ replayed: true, complete: true });
  });

  it('maps missing, unplanned, stale, confirmation, and order failures', async () => {
    const cases: {
      outcome: CatalogImportApplyOutcome;
      code: string;
    }[] = [
      { outcome: { kind: 'not_found' }, code: 'not_found' },
      { outcome: { kind: 'plan_incomplete' }, code: 'conflict' },
      { outcome: { kind: 'baseline_changed' }, code: 'revision_conflict' },
      {
        outcome: { kind: 'deactivation_confirmation_required', count: 2 },
        code: 'conflict',
      },
      {
        outcome: { kind: 'out_of_order', expectedBatchIndex: 1 },
        code: 'conflict',
      },
    ];

    for (const testCase of cases) {
      const repository = new FakeApplyRepository();
      repository.outcome = testCase.outcome;
      await expect(
        service(repository).applyBatch(ACTOR_ID, IMPORT_ID, REQUEST_ID, {
          batch_index: 0,
          confirm_deactivations: false,
        }),
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });
});
