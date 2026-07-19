import type { OperationEnvelope, SyncRequest } from '@ddl-tracker/contracts';

type IncrementalSyncRequest = Extract<SyncRequest, { mode: 'incremental' }>;

import { HttpError } from '../http/errors.js';
import type { SyncCursorCodec } from './cursor.js';
import {
  SyncCursorExpiredError,
  type SyncEventPage,
} from './postgres-event-reader.js';
import type { SyncOperationResult } from './batch-service.js';

export interface SyncBatchExecutor {
  execute(
    userId: string,
    operations: OperationEnvelope[],
  ): Promise<SyncOperationResult[]>;
}

export interface SyncEventReader {
  pull(input: {
    userId: string;
    maintainer: boolean;
    afterSequence: number;
    limit: number;
  }): Promise<SyncEventPage>;
}

export class IncrementalSyncService {
  readonly #batchExecutor: SyncBatchExecutor;
  readonly #eventReader: SyncEventReader;
  readonly #cursorCodec: SyncCursorCodec;

  constructor(options: {
    batchExecutor: SyncBatchExecutor;
    eventReader: SyncEventReader;
    cursorCodec: SyncCursorCodec;
  }) {
    this.#batchExecutor = options.batchExecutor;
    this.#eventReader = options.eventReader;
    this.#cursorCodec = options.cursorCodec;
  }

  async execute(input: {
    userId: string;
    maintainer: boolean;
    requestId: string;
    request: IncrementalSyncRequest;
  }): Promise<{
    protocol_version: 1;
    request_id: string;
    operation_results: SyncOperationResult[];
    events: SyncEventPage['events'];
    next_cursor: string;
    has_more: boolean;
  }> {
    let afterSequence: number;
    try {
      afterSequence = (
        await this.#cursorCodec.decode(input.request.cursor, input.userId)
      ).sequence;
    } catch {
      throw new HttpError({
        code: 'invalid_request',
        message: 'Sync cursor is invalid.',
        status: 400,
        details: {},
      });
    }

    const operationResults = await this.#batchExecutor.execute(
      input.userId,
      input.request.operations,
    );

    let page: SyncEventPage;
    try {
      page = await this.#eventReader.pull({
        userId: input.userId,
        maintainer: input.maintainer,
        afterSequence,
        limit: input.request.event_limit,
      });
    } catch (error) {
      if (error instanceof SyncCursorExpiredError) {
        throw new HttpError({
          code: 'cursor_expired',
          message: error.message,
          status: 409,
          details: { minimum_sequence: error.minimumSequence },
        });
      }
      throw error;
    }

    return {
      protocol_version: 1,
      request_id: input.requestId,
      operation_results: operationResults,
      events: page.events,
      next_cursor: await this.#cursorCodec.encode(
        input.userId,
        page.nextSequence,
      ),
      has_more: page.hasMore,
    };
  }
}
