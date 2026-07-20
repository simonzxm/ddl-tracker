import { describe, expect, it } from 'vitest';
import { syncRequestSchema } from '../src/sync/request.js';

const ID = '018f0000-0000-7000-8000-000000000000';
const SECTION_ID = '018f0000-0000-7000-8000-000000000100';

describe('sync request modes', () => {
  it('accepts account snapshots without cursors or operations', () => {
    expect(
      syncRequestSchema.parse({
        protocol_version: 1,
        mode: 'account_snapshot',
        snapshot_token: null,
        page_token: null,
        snapshot_limit: 200,
        operations: [],
      }).mode,
    ).toBe('account_snapshot');
  });

  it('accepts class-section snapshots with an opaque resume cursor', () => {
    expect(
      syncRequestSchema.parse({
        protocol_version: 1,
        mode: 'class_section_snapshot',
        cursor: 'cursor-1',
        class_section_id: ID,
        snapshot_token: null,
        page_token: null,
        snapshot_limit: 500,
        operations: [],
      }).mode,
    ).toBe('class_section_snapshot');
  });

  it('accepts incremental push and pull within documented limits', () => {
    expect(
      syncRequestSchema.parse({
        protocol_version: 1,
        mode: 'incremental',
        cursor: 'cursor-1',
        event_limit: 500,
        operations: Array.from({ length: 100 }, (_, index) => ({
          operation_id: `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
          type: 'follow_class_section',
          schema_version: 1,
          depends_on: [],
          payload: { class_section_id: SECTION_ID },
        })),
      }).mode,
    ).toBe('incremental');
  });

  it('rejects mixed modes, unsupported versions, and oversized pages', () => {
    expect(() =>
      syncRequestSchema.parse({
        protocol_version: 1,
        mode: 'account_snapshot',
        cursor: 'not-allowed',
        snapshot_token: null,
        page_token: null,
        snapshot_limit: 200,
        operations: [],
      }),
    ).toThrow();
    expect(() =>
      syncRequestSchema.parse({
        protocol_version: 2,
        mode: 'incremental',
        cursor: 'cursor-1',
        event_limit: 200,
        operations: [],
      }),
    ).toThrow();
    expect(() =>
      syncRequestSchema.parse({
        protocol_version: 1,
        mode: 'incremental',
        cursor: 'cursor-1',
        event_limit: 501,
        operations: [],
      }),
    ).toThrow();
  });
});
