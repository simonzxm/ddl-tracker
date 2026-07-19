import { describe, expect, it } from 'vitest';
import {
  incrementalSyncResponseSchema,
  operationResultSchema,
} from '../src/sync/response.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000000001';
const OPERATION_ID = '018f0000-0000-7000-8000-000000000002';
const EVENT_ID = '018f0000-0000-7000-8000-000000000003';

describe('operation results', () => {
  it('accepts applied and replayed results with stable result objects', () => {
    for (const status of ['applied', 'replayed'] as const) {
      expect(
        operationResultSchema.parse({
          operation_id: OPERATION_ID,
          status,
          result: { revision: 4 },
        }).status,
      ).toBe(status);
    }
  });

  it('accepts rejected and dependency-failed stable errors', () => {
    expect(
      operationResultSchema.parse({
        operation_id: OPERATION_ID,
        status: 'rejected',
        error: {
          code: 'revision_conflict',
          details: { current_revision: 5 },
          message: 'The record changed.',
          retryable: false,
        },
      }).status,
    ).toBe('rejected');

    expect(
      operationResultSchema.parse({
        operation_id: OPERATION_ID,
        status: 'dependency_failed',
        error: {
          code: 'dependency_failed',
          details: { failed_operation_ids: [REQUEST_ID] },
          message: 'A dependency failed.',
          retryable: false,
        },
      }).status,
    ).toBe('dependency_failed');
  });

  it('rejects success without result and dependency failure with another code', () => {
    expect(() =>
      operationResultSchema.parse({
        operation_id: OPERATION_ID,
        status: 'applied',
      }),
    ).toThrow();
    expect(() =>
      operationResultSchema.parse({
        operation_id: OPERATION_ID,
        status: 'dependency_failed',
        error: {
          code: 'revision_conflict',
          details: {},
          message: 'Wrong code.',
          retryable: false,
        },
      }),
    ).toThrow();
  });
});

describe('incremental sync response', () => {
  it('accepts committed partial success with events and an opaque cursor', () => {
    expect(
      incrementalSyncResponseSchema.parse({
        protocol_version: 1,
        request_id: REQUEST_ID,
        operation_results: [
          {
            operation_id: OPERATION_ID,
            status: 'applied',
            result: { revision: 4 },
          },
        ],
        events: [
          {
            event_id: EVENT_ID,
            schema_version: 1,
            type: 'personal_task_state_upserted',
            occurred_at: '2026-09-01T00:30:00Z',
            payload: { revision: 4 },
          },
        ],
        next_cursor: 'opaque-next',
        has_more: false,
      }).next_cursor,
    ).toBe('opaque-next');
  });

  it('rejects leaked sequence and oversized result pages through child schemas', () => {
    expect(() =>
      incrementalSyncResponseSchema.parse({
        protocol_version: 1,
        request_id: REQUEST_ID,
        operation_results: [],
        events: [
          {
            event_id: EVENT_ID,
            schema_version: 1,
            type: 'personal_task_state_upserted',
            occurred_at: '2026-09-01T00:30:00Z',
            payload: {},
            sequence: 10,
          },
        ],
        next_cursor: 'opaque-next',
        has_more: false,
      }),
    ).toThrow();
  });
});
