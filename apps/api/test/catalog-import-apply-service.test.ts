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
  receivedAll: Parameters<CatalogImportApplyRepository['applyAll']>[0] | null = null;

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

  it('returns stable progress for a replayed import', async () => {
    const repository = new FakeApplyRepository();
    repository.outcome = {
      kind: 'replayed',
      appliedBatches: 2,
      totalBatches: 2,
      complete: true,
    };

    await expect(
      service(repository).applyAll(ACTOR_ID, IMPORT_ID, REQUEST_ID, {
        confirm_deactivations: true,
      }),
    ).resolves.toMatchObject({ replayed: true, complete: true });
  });

  it('maps missing, unplanned, stale, and confirmation failures', async () => {
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
    ];

    for (const testCase of cases) {
      const repository = new FakeApplyRepository();
      repository.outcome = testCase.outcome;
      await expect(
        service(repository).applyAll(ACTOR_ID, IMPORT_ID, REQUEST_ID, {
          confirm_deactivations: false,
        }),
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });
});
