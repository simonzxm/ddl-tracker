import { describe, expect, it, vi } from 'vitest';

import {
  accountSnapshotResponseSchema,
  classSectionSnapshotResponseSchema,
  incrementalSyncResponseSchema,
  type SyncRequest,
} from '@ddl-tracker/contracts';

import { SyncCursorCodec } from '../src/sync/cursor.js';
import type { SnapshotPage } from '../src/sync/postgres-snapshot-reader.js';
import { SnapshotTokenCodec } from '../src/sync/snapshot-token.js';
import { SyncService } from '../src/sync/sync-service.js';

const USER_ID = '018f0000-0000-7000-8000-000000002701';
const SECTION_ID = '018f0000-0000-7000-8000-000000002702';
const RECORD_ID = '018f0000-0000-7000-8000-000000002703';
const COURSE_ID = '018f0000-0000-7000-8000-000000002705';
const REQUEST_ID = '018f0000-0000-7000-8000-000000002704';
const NOW = new Date('2026-07-19T12:00:00.000Z');
const SECRET = 's'.repeat(64);

type AccountRequest = Extract<SyncRequest, { mode: 'account_snapshot' }>;
type ClassRequest = Extract<SyncRequest, { mode: 'class_section_snapshot' }>;
type IncrementalRequest = Extract<SyncRequest, { mode: 'incremental' }>;

function accountRequest(
  overrides: Partial<AccountRequest> = {},
): AccountRequest {
  return {
    protocol_version: 2,
    mode: 'account_snapshot',
    snapshot_token: null,
    page_token: null,
    snapshot_limit: 10,
    operations: [],
    ...overrides,
  };
}

function reader() {
  return {
    readAnchor: vi.fn(async () => 42),
    readAccountPage: vi.fn(async (): Promise<SnapshotPage> => ({
      records: [
        {
          record_type: 'personal_todo',
          schema_version: 1,
          id: RECORD_ID,
          payload: {
            id: RECORD_ID,
            class_section_id: null,
            title: 'Mine',
            deadline: null,
            note: null,
            state: 'pending',
            revision: 3,
            deleted_at: null,
            created_at: NOW.toISOString(),
            updated_at: NOW.toISOString(),
          },
        },
      ],
      complete: true,
      nextAfter: null,
    })),
    readClassSectionPage: vi.fn(async (): Promise<SnapshotPage> => ({
      records: [
        {
          record_type: 'class_section',
          schema_version: 1,
          id: SECTION_ID,
          payload: {
            id: SECTION_ID,
            course_id: COURSE_ID,
            external_section_id: 'section-1',
            section_number: '01',
            department_code: null,
            department_name: null,
            instructors: [],
            campus: null,
            capacity: null,
            schedule_text: null,
            active: true,
            revision: 2,
            created_at: NOW.toISOString(),
            updated_at: NOW.toISOString(),
          },
        },
      ],
      complete: true,
      nextAfter: null,
    })),
  };
}

function service(options?: { reader?: ReturnType<typeof reader> }) {
  const cursorCodec = new SyncCursorCodec(SECRET, 'test');
  const snapshotCodec = new SnapshotTokenCodec(SECRET, 'test');
  const snapshotReader = options?.reader ?? reader();
  const incremental = {
    execute: vi.fn(async () => ({
      protocol_version: 2 as const,
      request_id: REQUEST_ID,
      operation_results: [],
      events: [],
      next_cursor: await cursorCodec.encode(USER_ID, 9),
      has_more: false,
    })),
  };
  return {
    cursorCodec,
    snapshotCodec,
    snapshotReader,
    incremental,
    value: new SyncService({
      cursorCodec,
      snapshotCodec,
      snapshotReader,
      incremental,
      now: () => NOW,
    }),
  };
}

describe('SyncService', () => {
  it('delegates incremental sync unchanged', async () => {
    const fixture = service();
    const request: IncrementalRequest = {
      protocol_version: 2,
      mode: 'incremental',
      cursor: await fixture.cursorCodec.encode(USER_ID, 0),
      event_limit: 10,
      operations: [],
    };

    const response = await fixture.value.execute({
      userId: USER_ID,
      maintainer: false,
      requestId: REQUEST_ID,
      request,
    });

    expect(incrementalSyncResponseSchema.parse(response).has_more).toBe(false);
    expect(fixture.incremental.execute).toHaveBeenCalledOnce();
  });

  it('creates an account snapshot at the current anchor', async () => {
    const fixture = service();

    const response = accountSnapshotResponseSchema.parse(
      await fixture.value.execute({
        userId: USER_ID,
        maintainer: false,
        requestId: REQUEST_ID,
        request: accountRequest(),
      }),
    );

    expect(response.snapshot_complete).toBe(true);
    expect(response.records[0]).toMatchObject({
      record_type: 'personal_todo',
      schema_version: 1,
      payload: {
        id: RECORD_ID,
        revision: 3,
      },
    });
    expect((await fixture.cursorCodec.decode(response.next_cursor ?? '', USER_ID)).sequence).toBe(42);
    expect(fixture.snapshotReader.readAnchor).toHaveBeenCalledOnce();
  });

  it('continues an account snapshot with a bound page token', async () => {
    const snapshotReader = reader();
    snapshotReader.readAccountPage
      .mockResolvedValueOnce({
        records: [],
        complete: false,
        nextAfter: { recordType: 'personal_todo', id: RECORD_ID },
      })
      .mockResolvedValueOnce({ records: [], complete: true, nextAfter: null });
    const fixture = service({ reader: snapshotReader });

    const first = accountSnapshotResponseSchema.parse(
      await fixture.value.execute({
        userId: USER_ID,
        maintainer: false,
        requestId: REQUEST_ID,
        request: accountRequest(),
      }),
    );
    expect(first.next_page_token).not.toBeNull();

    const second = accountSnapshotResponseSchema.parse(
      await fixture.value.execute({
        userId: USER_ID,
        maintainer: false,
        requestId: REQUEST_ID,
        request: accountRequest({
          snapshot_token: first.snapshot_token,
          page_token: first.next_page_token,
        }),
      }),
    );

    expect(second.snapshot_complete).toBe(true);
    expect(snapshotReader.readAnchor).toHaveBeenCalledOnce();
    expect(snapshotReader.readAccountPage).toHaveBeenLastCalledWith({
      userId: USER_ID,
      after: { recordType: 'personal_todo', id: RECORD_ID },
      limit: 10,
    });
  });

  it('returns the original cursor after a class-section snapshot', async () => {
    const fixture = service();
    const cursor = await fixture.cursorCodec.encode(USER_ID, 7);
    const request: ClassRequest = {
      protocol_version: 2,
      mode: 'class_section_snapshot',
      cursor,
      class_section_id: SECTION_ID,
      snapshot_token: null,
      page_token: null,
      snapshot_limit: 10,
      operations: [],
    };

    const response = classSectionSnapshotResponseSchema.parse(
      await fixture.value.execute({
        userId: USER_ID,
        maintainer: false,
        requestId: REQUEST_ID,
        request,
      }),
    );

    expect(response.resume_cursor).toBe(cursor);
    expect(response.class_section_id).toBe(SECTION_ID);
    expect(fixture.snapshotReader.readClassSectionPage).toHaveBeenCalledOnce();
  });

  it('rejects a page token without its snapshot token', async () => {
    const fixture = service();

    await expect(
      fixture.value.execute({
        userId: USER_ID,
        maintainer: false,
        requestId: REQUEST_ID,
        request: accountRequest({ page_token: 'opaque.page' }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
  });
});
