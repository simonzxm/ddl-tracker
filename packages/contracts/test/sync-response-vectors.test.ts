import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { apiErrorSchema } from '../src/error.js';
import { incrementalSyncResponseSchema } from '../src/sync/response.js';
import {
  accountSnapshotResponseSchema,
  classSectionSnapshotResponseSchema,
} from '../src/sync/snapshot.js';

function readVector(): Record<string, unknown> {
  const value: unknown = JSON.parse(
    readFileSync(
      new URL('../vectors/sync-responses-v2.json', import.meta.url),
      'utf8',
    ),
  );
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Sync response vector must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function entries(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${label} entry must be an object.`);
    }
    return entry as Record<string, unknown>;
  });
}

function parseResponse(schema: unknown, value: unknown): unknown {
  switch (schema) {
    case 'account_snapshot':
      return accountSnapshotResponseSchema.parse(value);
    case 'class_section_snapshot':
      return classSectionSnapshotResponseSchema.parse(value);
    case 'incremental':
      return incrementalSyncResponseSchema.parse(value);
    default:
      throw new Error(`Unknown response vector schema: ${String(schema)}.`);
  }
}

describe('sync response v2 language-neutral vectors', () => {
  const vector = readVector();

  it('covers complete response envelopes and every operation status', () => {
    expect(vector.protocol_version).toBe(2);
    const responses = entries(vector.responses, 'responses');
    const parsed = responses.map(({ schema, value }) =>
      parseResponse(schema, value),
    );

    expect(parsed).toHaveLength(5);
    const incremental = incrementalSyncResponseSchema.parse(
      responses.find(({ schema }) => schema === 'incremental')?.value,
    );
    expect(incremental.operation_results.map(({ status }) => status)).toEqual([
      'applied',
      'replayed',
      'rejected',
      'dependency_failed',
    ]);
  });

  it('covers request-level cursor expiry errors', () => {
    const errors = entries(vector.errors, 'errors');
    expect(errors.map(({ value }) => apiErrorSchema.parse(value).code)).toEqual([
      'cursor_expired',
    ]);
  });

  it('rejects unknown protocol, event, and snapshot record versions', () => {
    const invalid = entries(vector.invalid_responses, 'invalid_responses');
    expect(invalid.map(({ schema, value }) => () => parseResponse(schema, value))).toEqual(
      expect.arrayContaining([expect.any(Function)]),
    );
    for (const { schema, value } of invalid) {
      expect(() => parseResponse(schema, value)).toThrow();
    }
  });
});
