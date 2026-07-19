import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OperationEnvelope } from '@ddl-tracker/contracts';

import {
  SyncBatchService,
  SyncOperationRejection,
} from '../src/sync/batch-service.js';
import { PostgresSyncBatchRepository } from '../src/sync/postgres-batch-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000001501';
const OP_1 = '018f0000-0000-7000-8000-000000001502';
const OP_2 = '018f0000-0000-7000-8000-000000001503';
const TODO_1 = '018f0000-0000-7000-8000-000000001504';
const TODO_2 = '018f0000-0000-7000-8000-000000001505';

function operation(operationId: string, todoId: string): OperationEnvelope {
  return {
    operation_id: operationId,
    type: 'follow_class_section',
    schema_version: 1,
    depends_on: [],
    payload: {
      class_section_id: todoId,
    },
  } as OperationEnvelope;
}

describePostgres('PostgresSyncBatchRepository', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query(
      'truncate table operation_receipts, personal_todos, users cascade',
    );
    await client.query(
      `insert into users (
         id, username, username_key, display_name, status, profile_revision
       ) values ($1, 'student', 'student', 'Student', 'active', 1)`,
      [USER_ID],
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it('rolls back only the rejected operation savepoint and persists both receipts', async () => {
    const repository = new PostgresSyncBatchRepository(client, async (_userId, value) => {
      const todoId = String((value.payload as Record<string, unknown>)['class_section_id']);
      await client.query(
        `insert into personal_todos (id, user_id, title)
         values ($1, $2, $3)`,
        [todoId, USER_ID, todoId],
      );
      if (value.operation_id === OP_1) {
        throw new SyncOperationRejection({
          code: 'revision_conflict',
          message: 'Rejected after mutation.',
        });
      }
      return { personal_todo_id: todoId, revision: 1 };
    });
    const service = new SyncBatchService({ repository });

    const results = await service.execute(USER_ID, [
      operation(OP_1, TODO_1),
      operation(OP_2, TODO_2),
    ]);

    expect(results.map(({ status }) => status)).toEqual(['rejected', 'applied']);
    const todos = await client.query<{ id: string }>(
      'select id from personal_todos order by id',
    );
    expect(todos.rows).toEqual([{ id: TODO_2 }]);
    const receipts = await client.query<{
      operation_id: string;
      status: string;
      stable_result: unknown;
    }>(
      `select operation_id, status, stable_result
       from operation_receipts order by operation_id`,
    );
    expect(receipts.rows).toEqual([
      expect.objectContaining({ operation_id: OP_1, status: 'rejected' }),
      expect.objectContaining({ operation_id: OP_2, status: 'applied' }),
    ]);
  });

  it('replays a stored receipt after a new service instance', async () => {
    let executionCount = 0;
    const firstRepository = new PostgresSyncBatchRepository(
      client,
      async (_userId, value) => {
        executionCount += 1;
        return { entity_id: value.operation_id };
      },
    );
    await new SyncBatchService({ repository: firstRepository }).execute(USER_ID, [
      operation(OP_1, TODO_1),
    ]);
    const secondRepository = new PostgresSyncBatchRepository(
      client,
      async () => {
        executionCount += 1;
        return {};
      },
    );

    const replay = await new SyncBatchService({
      repository: secondRepository,
    }).execute(USER_ID, [operation(OP_1, TODO_1)]);

    expect(replay[0]?.status).toBe('replayed');
    expect(executionCount).toBe(1);
  });

  it('rolls back all state and receipts on an infrastructure failure', async () => {
    const repository = new PostgresSyncBatchRepository(client, async (_userId, value) => {
      const todoId = String((value.payload as Record<string, unknown>)['class_section_id']);
      await client.query(
        `insert into personal_todos (id, user_id, title)
         values ($1, $2, 'Temporary')`,
        [todoId, USER_ID],
      );
      throw new Error('database transport failed');
    });

    await expect(
      new SyncBatchService({ repository }).execute(USER_ID, [
        operation(OP_1, TODO_1),
      ]),
    ).rejects.toThrow('database transport failed');

    const state = await client.query<{ todos: string; receipts: string }>(
      `select
         (select count(*) from personal_todos)::text as todos,
         (select count(*) from operation_receipts)::text as receipts`,
    );
    expect(state.rows[0]).toEqual({ todos: '0', receipts: '0' });
  });
});
