import { describe, expect, it } from 'vitest';
import { operationEnvelopeSchema } from '../src/sync/operation.js';

const ID = '018f0000-0000-7000-8000-000000000001';

describe('operation identity separation', () => {
  it('rejects reusing an operation ID as a private entity ID', () => {
    expect(() =>
      operationEnvelopeSchema.parse({
        operation_id: ID,
        type: 'create_personal_todo',
        schema_version: 1,
        depends_on: [],
        payload: {
          personal_todo_id: ID,
          class_section_id: null,
          title: 'Read',
          deadline: null,
          note: null,
          state: 'pending',
        },
      }),
    ).toThrow('entity ID');
  });

  it('rejects reusing an operation ID as a public entity ID', () => {
    expect(() =>
      operationEnvelopeSchema.parse({
        operation_id: ID,
        type: 'set_accuracy_vote',
        schema_version: 1,
        depends_on: [],
        payload: {
          proposal_id: ID,
          value: 'up',
        },
      }),
    ).toThrow('entity ID');
  });
});
