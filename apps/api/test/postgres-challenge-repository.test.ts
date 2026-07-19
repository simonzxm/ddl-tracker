import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresChallengeRepository } from '../src/auth/postgres-challenge-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

const OLD_ID = '018f0000-0000-7000-8000-000000000001';
const NEW_ID = '018f0000-0000-7000-8000-000000000002';
const SUBJECT = 'student@example.edu';

describePostgres('PostgresChallengeRepository', () => {
  let client: Client;
  let repository: PostgresChallengeRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresChallengeRepository(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('keeps the old active challenge valid until the pending one activates', async () => {
    await client.query('delete from auth_challenges');
    const createdAt = new Date('2026-07-19T12:00:00.000Z');
    const expiresAt = new Date('2026-07-19T12:10:00.000Z');

    await repository.createPending({
      id: OLD_ID,
      provider: 'email',
      normalizedSubject: SUBJECT,
      subjectDisplay: SUBJECT,
      codeHmac: 'old-hmac',
      attempts: 0,
      createdAt,
      expiresAt,
    });
    await repository.activatePending(OLD_ID, 'email', SUBJECT);

    await repository.createPending({
      id: NEW_ID,
      provider: 'email',
      normalizedSubject: SUBJECT,
      subjectDisplay: SUBJECT,
      codeHmac: 'new-hmac',
      attempts: 0,
      createdAt: new Date(createdAt.getTime() + 61_000),
      expiresAt: new Date(expiresAt.getTime() + 61_000),
    });

    await expect(repository.findActive(OLD_ID, 'email', SUBJECT)).resolves.toMatchObject({
      id: OLD_ID,
      codeHmac: 'old-hmac',
    });
    await expect(repository.findActive(NEW_ID, 'email', SUBJECT)).resolves.toBeNull();

    await repository.activatePending(NEW_ID, 'email', SUBJECT);

    await expect(repository.findActive(OLD_ID, 'email', SUBJECT)).resolves.toBeNull();
    await expect(repository.findActive(NEW_ID, 'email', SUBJECT)).resolves.toMatchObject({
      id: NEW_ID,
      codeHmac: 'new-hmac',
    });
  });

  it('abandons a failed pending delivery without replacing the active code', async () => {
    await client.query('delete from auth_challenges');
    const createdAt = new Date('2026-07-19T12:00:00.000Z');
    const expiresAt = new Date('2099-07-19T12:10:00.000Z');

    await repository.createPending({
      id: OLD_ID,
      provider: 'email',
      normalizedSubject: SUBJECT,
      subjectDisplay: SUBJECT,
      codeHmac: 'old-hmac',
      attempts: 0,
      createdAt,
      expiresAt,
    });
    await repository.activatePending(OLD_ID, 'email', SUBJECT);
    await repository.createPending({
      id: NEW_ID,
      provider: 'email',
      normalizedSubject: SUBJECT,
      subjectDisplay: SUBJECT,
      codeHmac: 'new-hmac',
      attempts: 0,
      createdAt: new Date(createdAt.getTime() + 61_000),
      expiresAt,
    });
    await repository.abandonPending(NEW_ID);

    await expect(repository.findActive(OLD_ID, 'email', SUBJECT)).resolves.toMatchObject({
      id: OLD_ID,
    });
    await expect(repository.findActive(NEW_ID, 'email', SUBJECT)).resolves.toBeNull();
  });

  it('tracks attempts and atomically consumes one active challenge', async () => {
    await client.query('delete from auth_challenges');
    await repository.createPending({
      id: OLD_ID,
      provider: 'email',
      normalizedSubject: SUBJECT,
      subjectDisplay: SUBJECT,
      codeHmac: 'hmac',
      attempts: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.activatePending(OLD_ID, 'email', SUBJECT);

    await expect(repository.recordFailedAttempt(OLD_ID, 5)).resolves.toEqual({
      attempts: 1,
      locked: false,
    });
    await expect(repository.consume(OLD_ID)).resolves.toBe(true);
    await expect(repository.consume(OLD_ID)).resolves.toBe(false);
  });
});
