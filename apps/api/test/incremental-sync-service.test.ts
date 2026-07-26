import { describe, expect, it, vi } from 'vitest';

import type { OperationEnvelope, SyncRequest } from '@ddl-tracker/contracts';

type IncrementalSyncRequest = Extract<SyncRequest, { mode: 'incremental' }>;

import {
  IncrementalSyncService,
  type SyncBatchExecutor,
  type SyncEventReader,
} from '../src/sync/incremental-service.js';
import { SyncCursorCodec } from '../src/sync/cursor.js';
import {
  SyncCursorExpiredError,
  type SyncEventPage,
} from '../src/sync/postgres-event-reader.js';

const USER_ID = '018f0000-0000-7000-8000-000000002301';
const REQUEST_ID = '018f0000-0000-7000-8000-000000002302';
const OPERATION_ID = '018f0000-0000-7000-8000-000000002303';
const EVENT_ID = '018f0000-0000-7000-8000-000000002304';
const SECRET = '0123456789abcdef0123456789abcdef';

function request(cursor: string): IncrementalSyncRequest {
  return {
    protocol_version: 1,
    mode: 'incremental',
    cursor,
    event_limit: 200,
    operations: [
      {
        operation_id: OPERATION_ID,
        type: 'follow_class_section',
        schema_version: 1,
        depends_on: [],
        payload: {
          class_section_id: '018f0000-0000-7000-8000-000000002305',
        },
      } as OperationEnvelope,
    ],
  };
}

function batchExecutor(): SyncBatchExecutor & {
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    execute: vi.fn(async () => [
      {
        operation_id: OPERATION_ID,
        status: 'applied' as const,
        result: { followed: true },
      },
    ]),
  };
}

function eventReader(): SyncEventReader & {
  pull: ReturnType<typeof vi.fn>;
} {
  return {
    pull: vi.fn(async (): Promise<SyncEventPage> => ({
      events: [
        {
          event_id: EVENT_ID,
          schema_version: 2,
          type: 'class_section_followed',
          occurred_at: '2026-07-19T12:00:00.000Z',
          payload: {
            class_section_id: '018f0000-0000-7000-8000-000000002305',
            followed_at: '2026-07-19T12:00:00.000Z',
          },
        },
      ],
      nextSequence: 12,
      hasMore: false,
    })),
  };
}

describe('IncrementalSyncService', () => {
  it('pulls visible events before pushing operations and signs that cursor', async () => {
    const cursorCodec = new SyncCursorCodec(SECRET, 'staging');
    const cursor = await cursorCodec.encode(USER_ID, 7);
    const batches = batchExecutor();
    const events = eventReader();
    const service = new IncrementalSyncService({
      batchExecutor: batches,
      eventReader: events,
      cursorCodec,
    });

    const response = await service.execute({
      userId: USER_ID,
      maintainer: false,
      requestId: REQUEST_ID,
      request: request(cursor),
    });

    expect(events.pull).toHaveBeenCalledWith({
      userId: USER_ID,
      maintainer: false,
      afterSequence: 7,
      limit: 200,
    });
    expect(batches.execute).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Array),
    );
    expect(events.pull.mock.invocationCallOrder[0]).toBeLessThan(
      batches.execute.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(response).toMatchObject({
      protocol_version: 1,
      request_id: REQUEST_ID,
      operation_results: [{ status: 'applied' }],
      events: [{ event_id: EVENT_ID }],
      has_more: false,
    });
    await expect(
      cursorCodec.decode(response.next_cursor, USER_ID),
    ).resolves.toEqual({ sequence: 12 });
  });

  it('rejects a cursor bound to another account', async () => {
    const cursorCodec = new SyncCursorCodec(SECRET, 'staging');
    const cursor = await cursorCodec.encode(
      '018f0000-0000-7000-8000-000000002399',
      7,
    );
    const service = new IncrementalSyncService({
      batchExecutor: batchExecutor(),
      eventReader: eventReader(),
      cursorCodec,
    });

    await expect(
      service.execute({
        userId: USER_ID,
        maintainer: false,
        requestId: REQUEST_ID,
        request: request(cursor),
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('maps an expired event cursor to cursor_expired', async () => {
    const cursorCodec = new SyncCursorCodec(SECRET, 'staging');
    const cursor = await cursorCodec.encode(USER_ID, 7);
    const events = eventReader();
    events.pull.mockRejectedValueOnce(new SyncCursorExpiredError(10));
    const batches = batchExecutor();
    const service = new IncrementalSyncService({
      batchExecutor: batches,
      eventReader: events,
      cursorCodec,
    });

    await expect(
      service.execute({
        userId: USER_ID,
        maintainer: false,
        requestId: REQUEST_ID,
        request: request(cursor),
      }),
    ).rejects.toMatchObject({
      code: 'cursor_expired',
      details: { minimum_sequence: 10 },
    });
    expect(batches.execute).not.toHaveBeenCalled();
  });

  it('keeps the pre-push cursor when the operation transaction fails', async () => {
    const cursorCodec = new SyncCursorCodec(SECRET, 'staging');
    const cursor = await cursorCodec.encode(USER_ID, 7);
    const batches = batchExecutor();
    batches.execute.mockRejectedValueOnce(new Error('commit failed'));
    const events = eventReader();
    const service = new IncrementalSyncService({
      batchExecutor: batches,
      eventReader: events,
      cursorCodec,
    });

    await expect(
      service.execute({
        userId: USER_ID,
        maintainer: false,
        requestId: REQUEST_ID,
        request: request(cursor),
      }),
    ).rejects.toThrow('commit failed');
    expect(events.pull).toHaveBeenCalledOnce();
  });
});
