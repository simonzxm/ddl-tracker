import { describe, expect, it } from 'vitest';
import {
  accountSnapshotResponseSchema,
  classSectionSnapshotResponseSchema,
} from '../src/sync/snapshot.js';

const REQUEST_ID = '018f0000-0000-7000-8000-000000000001';
const RECORD_ID = '018f0000-0000-7000-8000-000000000002';
const SECTION_ID = '018f0000-0000-7000-8000-000000000003';
const record = {
  record_type: 'personal_todo',
  id: RECORD_ID,
  revision: 3,
  payload: { title: 'Read' },
};

describe('account snapshot pagination', () => {
  it('requires a page token before completion', () => {
    expect(
      accountSnapshotResponseSchema.parse({
        protocol_version: 1,
        mode: 'account_snapshot',
        request_id: REQUEST_ID,
        records: [record],
        snapshot_token: 'snapshot-1',
        next_page_token: 'page-2',
        snapshot_complete: false,
        next_cursor: null,
      }).snapshot_complete,
    ).toBe(false);
  });

  it('returns the anchor cursor only on the complete page', () => {
    expect(
      accountSnapshotResponseSchema.parse({
        protocol_version: 1,
        mode: 'account_snapshot',
        request_id: REQUEST_ID,
        records: [],
        snapshot_token: 'snapshot-1',
        next_page_token: null,
        snapshot_complete: true,
        next_cursor: 'anchor-cursor',
      }).next_cursor,
    ).toBe('anchor-cursor');

    expect(() =>
      accountSnapshotResponseSchema.parse({
        protocol_version: 1,
        mode: 'account_snapshot',
        request_id: REQUEST_ID,
        records: [],
        snapshot_token: 'snapshot-1',
        next_page_token: null,
        snapshot_complete: false,
        next_cursor: null,
      }),
    ).toThrow();
  });
});

describe('class-section snapshot pagination', () => {
  it('returns the original resume cursor only on completion', () => {
    expect(
      classSectionSnapshotResponseSchema.parse({
        protocol_version: 1,
        mode: 'class_section_snapshot',
        request_id: REQUEST_ID,
        class_section_id: SECTION_ID,
        records: [record],
        snapshot_token: 'snapshot-2',
        next_page_token: null,
        snapshot_complete: true,
        resume_cursor: 'original-cursor',
      }).resume_cursor,
    ).toBe('original-cursor');
  });

  it('rejects cursors on incomplete pages and unknown record types', () => {
    expect(() =>
      classSectionSnapshotResponseSchema.parse({
        protocol_version: 1,
        mode: 'class_section_snapshot',
        request_id: REQUEST_ID,
        class_section_id: SECTION_ID,
        records: [],
        snapshot_token: 'snapshot-2',
        next_page_token: 'page-2',
        snapshot_complete: false,
        resume_cursor: 'too-early',
      }),
    ).toThrow();
    expect(() =>
      accountSnapshotResponseSchema.parse({
        protocol_version: 1,
        mode: 'account_snapshot',
        request_id: REQUEST_ID,
        records: [{ ...record, record_type: 'password_hash' }],
        snapshot_token: 'snapshot-1',
        next_page_token: null,
        snapshot_complete: true,
        next_cursor: 'anchor-cursor',
      }),
    ).toThrow();
  });
});
