import { describe, expect, it } from 'vitest';
import {
  operationBatchSchema,
  operationEnvelopeSchema,
} from '../src/sync/operation.js';

const FIRST = '018f0000-0000-7000-8000-000000000001';
const SECOND = '018f0000-0000-7000-8000-000000000002';

function operation(
  operation_id: string,
  depends_on: string[] = [],
): Record<string, unknown> {
  return {
    operation_id,
    type: 'follow_class_section',
    schema_version: 1,
    depends_on,
    payload: {
      class_section_id: '018f0000-0000-7000-8000-000000000010',
    },
  };
}

describe('operation envelope', () => {
  it('accepts known versioned student operations', () => {
    expect(operationEnvelopeSchema.parse(operation(FIRST)).operation_id).toBe(
      FIRST,
    );
  });

  it('rejects unknown types, versions, and extra envelope fields', () => {
    expect(() =>
      operationEnvelopeSchema.parse({
        ...operation(FIRST),
        type: 'drop_database',
      }),
    ).toThrow();
    expect(() =>
      operationEnvelopeSchema.parse({
        ...operation(FIRST),
        schema_version: 2,
      }),
    ).toThrow();
    expect(() =>
      operationEnvelopeSchema.parse({
        ...operation(FIRST),
        user_id: FIRST,
      }),
    ).toThrow();
  });
});

describe('operation batch dependencies', () => {
  it('allows dependencies only on earlier successful-intent entries', () => {
    expect(
      operationBatchSchema.parse([
        operation(FIRST),
        operation(SECOND, [FIRST]),
      ]),
    ).toHaveLength(2);
  });

  it('rejects duplicate operation IDs and forward or missing dependencies', () => {
    expect(() =>
      operationBatchSchema.parse([operation(FIRST), operation(FIRST)]),
    ).toThrow();
    expect(() =>
      operationBatchSchema.parse([
        operation(FIRST, [SECOND]),
        operation(SECOND),
      ]),
    ).toThrow();
    expect(() =>
      operationBatchSchema.parse([operation(FIRST, [SECOND])]),
    ).toThrow();
  });

  it('rejects repeated dependency IDs', () => {
    expect(() =>
      operationBatchSchema.parse([
        operation(FIRST),
        operation(SECOND, [FIRST, FIRST]),
      ]),
    ).toThrow();
  });
});
