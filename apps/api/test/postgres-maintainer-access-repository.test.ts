import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresMaintainerAccessRepository } from '../src/admin/postgres-maintainer-access-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const FIRST_ID = '018f0000-0000-7000-8000-000000003201';
const SECOND_ID = '018f0000-0000-7000-8000-000000003202';
const REQUEST_ID = '018f0000-0000-7000-8000-000000003203';
const SESSION_ID = '018f0000-0000-7000-8000-000000003204';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function ids(): () => string {
  let value = 3200;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

async function seed(client: Client): Promise<void> {
  await client.query(
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values
       ($1, 'first', 'first', 'First', 'active', 1),
       ($2, 'second', 'second', 'Second', 'active', 1)`,
    [FIRST_ID, SECOND_ID],
  );
  await client.query(
    `insert into sessions (
       id, user_id, token_hash, idle_expires_at, absolute_expires_at
     ) values ($1, $2, 'session-hash', $3, $4)`,
    [SESSION_ID, FIRST_ID, new Date('2026-08-19T12:00:00Z'), new Date('2027-01-19T12:00:00Z')],
  );
}

describePostgres('PostgresMaintainerAccessRepository', () => {
  let client: Client;
  let repository: PostgresMaintainerAccessRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresMaintainerAccessRepository(client, {
      createId: ids(),
      now: () => NOW,
    });
  });

  beforeEach(async () => {
    await client.query(`
      truncate table audit_log, moderation_actions, user_roles, sessions,
        users restart identity cascade
    `);
    await seed(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('bootstraps exactly one active registered user', async () => {
    await expect(
      repository.bootstrap({ actorId: FIRST_ID, requestId: REQUEST_ID }),
    ).resolves.toEqual({ maintainer: true });
    await expect(
      repository.bootstrap({ actorId: SECOND_ID, requestId: REQUEST_ID }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });

    const state = await client.query<{ roles: string; audits: string }>(
      `select
         (select count(*) from user_roles)::text as roles,
         (select count(*) from audit_log where action = 'maintainer_bootstrap')::text as audits`,
    );
    expect(state.rows[0]).toEqual({ roles: '1', audits: '1' });
  });

  it('refuses to revoke or suspend the final maintainer', async () => {
    await repository.bootstrap({ actorId: FIRST_ID, requestId: REQUEST_ID });
    await expect(
      repository.setMaintainerRole({
        actorId: FIRST_ID,
        targetUserId: FIRST_ID,
        maintainer: false,
        reason: 'Rotate role.',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      repository.setUserSuspended({
        actorId: FIRST_ID,
        targetUserId: FIRST_ID,
        suspended: true,
        reason: 'Investigate account.',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('allows rotation, revokes sessions on suspension, and restores the user', async () => {
    await repository.bootstrap({ actorId: FIRST_ID, requestId: REQUEST_ID });
    await repository.setMaintainerRole({
      actorId: FIRST_ID,
      targetUserId: SECOND_ID,
      maintainer: true,
      reason: 'Add second maintainer.',
      requestId: REQUEST_ID,
    });
    await repository.setUserSuspended({
      actorId: SECOND_ID,
      targetUserId: FIRST_ID,
      suspended: true,
      reason: 'Temporary investigation.',
      requestId: REQUEST_ID,
    });

    const suspended = await client.query<{
      status: string;
      revoked_at: Date | null;
    }>(
      `select u.status, s.revoked_at
       from users u join sessions s on s.user_id = u.id
       where u.id = $1`,
      [FIRST_ID],
    );
    expect(suspended.rows[0]?.status).toBe('suspended');
    expect(suspended.rows[0]?.revoked_at).toEqual(NOW);

    await repository.setUserSuspended({
      actorId: SECOND_ID,
      targetUserId: FIRST_ID,
      suspended: false,
      reason: 'Investigation completed.',
      requestId: REQUEST_ID,
    });
    const restored = await client.query<{ status: string }>(
      'select status from users where id = $1',
      [FIRST_ID],
    );
    expect(restored.rows[0]?.status).toBe('active');
  });
});
