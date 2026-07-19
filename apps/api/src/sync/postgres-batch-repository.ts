import type { Client } from 'pg';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import type {
  StoredOperationReceipt,
  SyncBatchRepository,
  SyncBatchTransaction,
  SyncOperationExecution,
  SyncOperationErrorValue,
} from './batch-service.js';

interface ReceiptRow {
  user_id: string;
  operation_id: string;
  request_digest: string;
  status: StoredOperationReceipt['status'];
  stable_result: unknown;
  created_at: Date;
  expires_at: Date;
}

function parseStableResult(row: ReceiptRow): {
  result: SyncOperationExecution | null;
  error: SyncOperationErrorValue | null;
} {
  if (typeof row.stable_result !== 'object' || row.stable_result === null) {
    throw new Error('Operation receipt stable result is invalid.');
  }
  const stable = row.stable_result as Record<string, unknown>;
  if (row.status === 'applied') {
    const result = stable.result;
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new Error('Applied operation receipt result is invalid.');
    }
    return { result: result as SyncOperationExecution, error: null };
  }
  const error = stable.error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) {
    throw new Error('Rejected operation receipt error is invalid.');
  }
  const record = error as Record<string, unknown>;
  if (
    typeof record.code !== 'string' ||
    typeof record.message !== 'string' ||
    record.retryable !== false ||
    typeof record.details !== 'object' ||
    record.details === null ||
    Array.isArray(record.details)
  ) {
    throw new Error('Rejected operation receipt error shape is invalid.');
  }
  return {
    result: null,
    error: {
      code: record.code,
      message: record.message,
      retryable: false,
      details: record.details as Record<string, unknown>,
    },
  };
}

class PostgresSyncBatchTransaction implements SyncBatchTransaction {
  readonly #client: Client;
  readonly #execute: (
    userId: string,
    operation: OperationEnvelope,
  ) => Promise<SyncOperationExecution>;

  constructor(
    client: Client,
    execute: (
      userId: string,
      operation: OperationEnvelope,
    ) => Promise<SyncOperationExecution>,
  ) {
    this.#client = client;
    this.#execute = execute;
  }

  async getReceipt(
    userId: string,
    operationId: string,
  ): Promise<StoredOperationReceipt | null> {
    const result = await this.#client.query<ReceiptRow>(
      `select user_id, operation_id, request_digest, status, stable_result,
              created_at, expires_at
       from operation_receipts
       where user_id = $1 and operation_id = $2
       limit 1`,
      [userId, operationId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    const stable = parseStableResult(row);
    return {
      userId: row.user_id,
      operationId: row.operation_id,
      requestDigest: row.request_digest,
      status: row.status,
      result: stable.result,
      error: stable.error,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async saveReceipt(receipt: StoredOperationReceipt): Promise<void> {
    await this.#client.query(
      `insert into operation_receipts (
         user_id, operation_id, request_digest, status, stable_result,
         created_at, expires_at
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        receipt.userId,
        receipt.operationId,
        receipt.requestDigest,
        receipt.status,
        JSON.stringify(
          receipt.status === 'applied'
            ? { result: receipt.result }
            : { error: receipt.error },
        ),
        receipt.createdAt,
        receipt.expiresAt,
      ],
    );
  }

  executeOperation(
    userId: string,
    operation: OperationEnvelope,
  ): Promise<SyncOperationExecution> {
    return this.#execute(userId, operation);
  }

  async withSavepoint<T>(
    name: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (!/^operation_\d+$/u.test(name)) {
      throw new Error('Unsafe sync savepoint name.');
    }
    await this.#client.query(`savepoint ${name}`);
    try {
      const result = await callback();
      await this.#client.query(`release savepoint ${name}`);
      return result;
    } catch (error) {
      await this.#client.query(`rollback to savepoint ${name}`);
      await this.#client.query(`release savepoint ${name}`);
      throw error;
    }
  }
}

export class PostgresSyncBatchRepository implements SyncBatchRepository {
  readonly #client: Client;
  readonly #execute: (
    userId: string,
    operation: OperationEnvelope,
  ) => Promise<SyncOperationExecution>;

  constructor(
    client: Client,
    execute: (
      userId: string,
      operation: OperationEnvelope,
    ) => Promise<SyncOperationExecution>,
  ) {
    this.#client = client;
    this.#execute = execute;
  }

  async withTransaction<T>(
    callback: (transaction: SyncBatchTransaction) => Promise<T>,
  ): Promise<T> {
    await this.#client.query('begin');
    try {
      const transaction = new PostgresSyncBatchTransaction(
        this.#client,
        this.#execute,
      );
      const result = await callback(transaction);
      await this.#client.query('commit');
      return result;
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }
}
