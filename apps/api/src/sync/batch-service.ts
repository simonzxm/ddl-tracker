import {
  operationResultSchema,
  type OperationEnvelope,
  type OperationResult,
} from '@ddl-tracker/contracts';

const RECEIPT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export type SyncOperationExecution = Record<string, unknown>;

export type SyncOperationFollowUp = {
  type: 'class_section_snapshot';
  class_section_id: string;
} | null;

export interface SyncOperationErrorValue {
  code: string;
  details: Record<string, unknown>;
  message: string;
  retryable: false;
}

export type StableOperationStatus =
  | 'applied'
  | 'rejected'
  | 'dependency_failed';

export interface StoredOperationReceipt {
  userId: string;
  operationId: string;
  requestDigest: string;
  status: StableOperationStatus;
  result: SyncOperationExecution | null;
  error: SyncOperationErrorValue | null;
  createdAt: Date;
  expiresAt: Date;
}

export type SyncOperationResult = OperationResult;

export interface SyncBatchTransaction {
  getReceipt(
    userId: string,
    operationId: string,
  ): Promise<StoredOperationReceipt | null>;
  saveReceipt(receipt: StoredOperationReceipt): Promise<void>;
  executeOperation(
    userId: string,
    operation: OperationEnvelope,
  ): Promise<SyncOperationExecution>;
  withSavepoint<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface SyncBatchRepository {
  withTransaction<T>(
    callback: (transaction: SyncBatchTransaction) => Promise<T>,
  ): Promise<T>;
}

export class SyncOperationRejection extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(options: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = 'SyncOperationRejection';
    this.code = options.code;
    this.details = options.details ?? {};
  }
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

async function digestOperation(operation: OperationEnvelope): Promise<string> {
  const bytes = new TextEncoder().encode(
    canonicalJson({
      type: operation.type,
      schema_version: operation.schema_version,
      depends_on: operation.depends_on,
      payload: operation.payload,
    }),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function rejectionValue(error: SyncOperationRejection): SyncOperationErrorValue {
  return {
    code: error.code,
    details: error.details,
    message: error.message,
    retryable: false,
  };
}

function followUpFor(
  operation: OperationEnvelope,
  execution: SyncOperationExecution,
): SyncOperationFollowUp {
  if (
    operation.type === 'follow_class_section' &&
    execution.class_section_snapshot_required === true
  ) {
    return {
      type: 'class_section_snapshot',
      class_section_id: operation.payload.class_section_id,
    };
  }
  return null;
}

function resultFromReceipt(
  receipt: StoredOperationReceipt,
  operation: OperationEnvelope,
): SyncOperationResult {
  if (receipt.status === 'applied') {
    if (receipt.result === null) {
      throw new Error('Applied operation receipt is missing its result.');
    }
    return operationResultSchema.parse({
      operation_id: receipt.operationId,
      operation_type: operation.type,
      status: 'replayed',
      follow_up: followUpFor(operation, receipt.result),
    });
  }
  if (receipt.error === null) {
    throw new Error('Rejected operation receipt is missing its error.');
  }
  return operationResultSchema.parse({
    operation_id: receipt.operationId,
    operation_type: operation.type,
    status: receipt.status,
    error: receipt.error,
  });
}

export class SyncBatchService {
  readonly #repository: SyncBatchRepository;
  readonly #now: () => Date;

  constructor(options: {
    repository: SyncBatchRepository;
    now?: () => Date;
  }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  execute(
    userId: string,
    operations: OperationEnvelope[],
  ): Promise<SyncOperationResult[]> {
    return this.#repository.withTransaction(async (transaction) => {
      const results: SyncOperationResult[] = [];
      const resultByOperationId = new Map<string, SyncOperationResult>();

      for (const [index, operation] of operations.entries()) {
        const requestDigest = await digestOperation(operation);
        const receipt = await transaction.getReceipt(
          userId,
          operation.operation_id,
        );
        if (receipt !== null) {
          const result =
            receipt.requestDigest === requestDigest
              ? resultFromReceipt(receipt, operation)
              : operationResultSchema.parse({
                  operation_id: operation.operation_id,
                  operation_type: operation.type,
                  status: 'rejected',
                  error: {
                    code: 'operation_id_reused',
                    details: {},
                    message:
                      'Operation ID was already used with different content.',
                    retryable: false,
                  },
                });
          results.push(result);
          resultByOperationId.set(operation.operation_id, result);
          continue;
        }

        const failedDependencies = operation.depends_on.filter(
          (dependencyId) => {
            const dependency = resultByOperationId.get(dependencyId);
            return (
              dependency === undefined ||
              (dependency.status !== 'applied' &&
                dependency.status !== 'replayed')
            );
          },
        );
        if (failedDependencies.length > 0) {
          const error: SyncOperationErrorValue = {
            code: 'dependency_failed',
            details: { failed_operation_ids: failedDependencies },
            message: 'A declared operation dependency failed.',
            retryable: false,
          };
          const now = this.#now();
          const result = operationResultSchema.parse({
            operation_id: operation.operation_id,
            operation_type: operation.type,
            status: 'dependency_failed',
            error,
          });
          await transaction.saveReceipt({
            userId,
            operationId: operation.operation_id,
            requestDigest,
            status: 'dependency_failed',
            result: null,
            error,
            createdAt: now,
            expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS),
          });
          results.push(result);
          resultByOperationId.set(operation.operation_id, result);
          continue;
        }

        try {
          const result = await transaction.withSavepoint(
            `operation_${String(index)}`,
            async () => {
              const execution = await transaction.executeOperation(
                userId,
                operation,
              );
              const now = this.#now();
              await transaction.saveReceipt({
                userId,
                operationId: operation.operation_id,
                requestDigest,
                status: 'applied',
                result: execution,
                error: null,
                createdAt: now,
                expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS),
              });
              return operationResultSchema.parse({
                operation_id: operation.operation_id,
                operation_type: operation.type,
                status: 'applied',
                follow_up: followUpFor(operation, execution),
              });
            },
          );
          results.push(result);
          resultByOperationId.set(operation.operation_id, result);
        } catch (error) {
          if (!(error instanceof SyncOperationRejection)) {
            throw error;
          }
          const stableError = rejectionValue(error);
          const now = this.#now();
          const result = operationResultSchema.parse({
            operation_id: operation.operation_id,
            operation_type: operation.type,
            status: 'rejected',
            error: stableError,
          });
          await transaction.saveReceipt({
            userId,
            operationId: operation.operation_id,
            requestDigest,
            status: 'rejected',
            result: null,
            error: stableError,
            createdAt: now,
            expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS),
          });
          results.push(result);
          resultByOperationId.set(operation.operation_id, result);
        }
      }

      return results;
    });
  }
}
