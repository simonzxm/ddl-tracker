import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { latestMigrationHash } from '../src/db/latest-migration.js';
import { PostgresReadinessRepository } from '../src/db/postgres-readiness-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

describePostgres('PostgresReadinessRepository', () => {
  let client: Client;
  let repository: PostgresReadinessRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresReadinessRepository(client, latestMigrationHash);
  });

  afterAll(async () => {
    await client.end();
  });

  it('reports ready when the latest committed migration is applied', async () => {
    await expect(repository.isReady()).resolves.toBe(true);
  });

  it('reports not ready when the expected migration hash differs', async () => {
    const mismatched = new PostgresReadinessRepository(client, '0'.repeat(64));

    await expect(mismatched.isReady()).resolves.toBe(false);
  });
});
