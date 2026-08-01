import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OidcLoginTransaction } from '../src/auth/oidc-login-service.js';
import { PostgresOidcLoginRepository } from '../src/auth/postgres-oidc-login-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const TRANSACTION_ID = '018f0000-0000-7000-8000-000000000201';
const NOW = new Date('2026-07-30T12:00:00.000Z');

function pendingTransaction(): OidcLoginTransaction {
  return {
    id: TRANSACTION_ID,
    stateHash: 'state-hash',
    secretsCiphertext: 'sealed-secrets',
    redirectUri: 'https://ddl.nju.at/auth/callback',
    status: 'pending',
    issuer: null,
    subject: null,
    email: null,
    displayName: null,
    avatarUrl: null,
    exchangeCodeHash: null,
    errorCode: null,
    expiresAt: new Date('2026-07-30T12:10:00.000Z'),
    createdAt: NOW,
    completedAt: null,
    consumedAt: null,
  };
}

describePostgres('PostgresOidcLoginRepository', () => {
  let clients: readonly [Client, Client];
  let repositories: readonly [
    PostgresOidcLoginRepository,
    PostgresOidcLoginRepository,
  ];

  beforeAll(async () => {
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await Promise.all([first.connect(), second.connect()]);
    clients = [first, second];
    repositories = [
      new PostgresOidcLoginRepository(first),
      new PostgresOidcLoginRepository(second),
    ];
  });

  beforeEach(async () => {
    await clients[0].query('truncate table oidc_login_transactions');
  });

  afterAll(async () => {
    await Promise.all(clients.map(async (client) => client.end()));
  });

  it('allows only one concurrent callback to claim a pending transaction', async () => {
    await repositories[0].createPending(pendingTransaction());

    const claims = await Promise.all(
      repositories.map(async (repository) =>
        repository.claim(TRANSACTION_ID, NOW),
      ),
    );

    expect(claims.sort()).toEqual([false, true]);
    await expect(repositories[0].findById(TRANSACTION_ID)).resolves.toMatchObject({
      status: 'exchanging',
    });
  });
});
