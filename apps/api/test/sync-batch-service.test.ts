import { describe, expect, it } from 'vitest';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import {
  SyncBatchService,
  SyncOperationRejection,
  type StoredOperationReceipt,
  type SyncBatchTransaction,
  type SyncOperationExecution,
} from '../src/sync/batch-service.js';

const USER_ID = '018f0000-0000-7000-8000-000000001401';
const OP_1 = '018f0000-0000-7000-8000-000000001402';
const OP_2 = '018f0000-0000-7000-8000-000000001403';
const OP_3 = '018f0000-0000-7000-8000-000000001404';

function operation(
  operationId: string,
  overrides: Partial<OperationEnvelope> = {},
): OperationEnvelope {
  return {
    operation_id: operationId,
    type: 'follow_class_section',
    schema_version: 1,
    depends_on: [],
    payload: {
      class_section_id: '018f0000-0000-7000-8000-000000001405',
    },
    ...overrides,
  } as OperationEnvelope;
}

class FakeTransaction implements SyncBatchTransaction {
  receipts = new Map<string, StoredOperationReceipt>();
  executions: string[] = [];
  rejected = new Set<string>();
  infrastructureFailure = false;

  getReceipt(_userId: string, operationId: string) {
    return Promise.resolve(this.receipts.get(operationId) ?? null);
  }

  saveReceipt(receipt: StoredOperationReceipt): Promise<void> {
    this.receipts.set(receipt.operationId, receipt);
    return Promise.resolve();
  }

  async executeOperation(
    _userId: string,
    value: OperationEnvelope,
  ): Promise<SyncOperationExecution> {
    this.executions.push(value.operation_id);
    if (this.infrastructureFailure) {
      throw new Error('connection lost');
    }
    if (this.rejected.has(value.operation_id)) {
      throw new SyncOperationRejection({
        code: 'revision_conflict',
        message: 'Revision changed.',
        details: { current_revision: 2 },
      });
    }
    return { entity_id: value.operation_id, revision: 1 };
  }

  withSavepoint<T>(_name: string, callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

class FakeRepository {
  readonly transaction = new FakeTransaction();
  committed = false;

  async withTransaction<T>(
    callback: (transaction: SyncBatchTransaction) => Promise<T>,
  ): Promise<T> {
    const result = await callback(this.transaction);
    this.committed = true;
    return result;
  }
}

describe('SyncBatchService', () => {
  it('applies operations in order and stores stable receipts', async () => {
    const repository = new FakeRepository();
    const service = new SyncBatchService({ repository });

    const results = await service.execute(USER_ID, [operation(OP_1), operation(OP_2)]);

    expect(results.map(({ status }) => status)).toEqual(['applied', 'applied']);
    expect(repository.transaction.executions).toEqual([OP_1, OP_2]);
    expect(repository.transaction.receipts.size).toBe(2);
    expect(repository.committed).toBe(true);
  });

  it('replays an identical applied receipt without executing again', async () => {
    const repository = new FakeRepository();
    const service = new SyncBatchService({ repository });
    await service.execute(USER_ID, [operation(OP_1)]);
    repository.transaction.executions = [];

    const replay = await service.execute(USER_ID, [operation(OP_1)]);

    expect(replay).toEqual([
      expect.objectContaining({ operation_id: OP_1, status: 'replayed' }),
    ]);
    expect(repository.transaction.executions).toEqual([]);
  });

  it('rejects reuse of an operation ID with different content', async () => {
    const repository = new FakeRepository();
    const service = new SyncBatchService({ repository });
    await service.execute(USER_ID, [operation(OP_1)]);

    const results = await service.execute(USER_ID, [
      operation(OP_1, {
        payload: {
          class_section_id: '018f0000-0000-7000-8000-000000001499',
        },
      }),
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        status: 'rejected',
        error: expect.objectContaining({ code: 'operation_id_reused' }),
      }),
    ]);
    expect(repository.transaction.executions).toEqual([OP_1]);
  });

  it('continues independent operations after a business rejection', async () => {
    const repository = new FakeRepository();
    repository.transaction.rejected.add(OP_1);
    const service = new SyncBatchService({ repository });

    const results = await service.execute(USER_ID, [operation(OP_1), operation(OP_2)]);

    expect(results.map(({ status }) => status)).toEqual(['rejected', 'applied']);
    expect(repository.transaction.executions).toEqual([OP_1, OP_2]);
    expect(repository.transaction.receipts.size).toBe(2);
  });

  it('does not execute an operation whose declared dependency failed', async () => {
    const repository = new FakeRepository();
    repository.transaction.rejected.add(OP_1);
    const service = new SyncBatchService({ repository });

    const results = await service.execute(USER_ID, [
      operation(OP_1),
      operation(OP_2, { depends_on: [OP_1] }),
      operation(OP_3),
    ]);

    expect(results.map(({ status }) => status)).toEqual([
      'rejected',
      'dependency_failed',
      'applied',
    ]);
    expect(repository.transaction.executions).toEqual([OP_1, OP_3]);
  });

  it('propagates infrastructure failure instead of claiming partial success', async () => {
    const repository = new FakeRepository();
    repository.transaction.infrastructureFailure = true;
    const service = new SyncBatchService({ repository });

    await expect(service.execute(USER_ID, [operation(OP_1)])).rejects.toThrow(
      'connection lost',
    );
    expect(repository.committed).toBe(false);
  });
});
