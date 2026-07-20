import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresRetentionService } from '../src/maintenance/postgres-retention-service.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const USER_ID = '018f0000-0000-7000-8000-000000004001';
const SECTION_ID = '018f0000-0000-7000-8000-000000004002';
const TERM_ID = '018f0000-0000-7000-8000-000000004003';
const COURSE_ID = '018f0000-0000-7000-8000-000000004004';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function ids(): () => string {
  let value = 4100;
  return () => {
    value += 1;
    return `018f0000-0000-7000-8000-${String(value).padStart(12, '0')}`;
  };
}

async function seed(client: Client): Promise<void> {
  await client.query(
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values ($1, 'retention-user', 'retention_user', 'Retention', 'active', 1)`,
    [USER_ID],
  );
  await client.query(
    `insert into academic_terms (id, external_term_code, name)
     values ($1, 'term-retention', 'Term')`,
    [TERM_ID],
  );
  await client.query(
    `insert into courses (id, term_id, external_course_code, name)
     values ($1, $2, 'course-retention', 'Course')`,
    [COURSE_ID, TERM_ID],
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number
     ) values ($1, $2, 'section-retention', '01')`,
    [SECTION_ID, COURSE_ID],
  );

  await client.query(
    `insert into auth_challenges (
       id, provider, normalized_subject, subject_display, code_hmac,
       status, expires_at, created_at
     ) values
       ('018f0000-0000-7000-8000-000000004011', 'email',
        'old@example.edu', 'old@example.edu', 'old', 'expired',
        '2026-07-17T10:00:00Z', '2026-07-17T09:00:00Z'),
       ('018f0000-0000-7000-8000-000000004012', 'email',
        'new@example.edu', 'new@example.edu', 'new', 'expired',
        '2026-07-19T11:00:00Z', '2026-07-19T10:00:00Z')`,
  );
  await client.query(
    `insert into registration_tokens (
       id, token_hash, provider, normalized_subject, subject_display,
       expires_at, created_at
     ) values
       ('018f0000-0000-7000-8000-000000004013', 'old-token', 'email',
        'old-registration@example.edu', 'old-registration@example.edu',
        '2026-07-17T10:00:00Z', '2026-07-17T09:00:00Z'),
       ('018f0000-0000-7000-8000-000000004014', 'new-token', 'email',
        'new-registration@example.edu', 'new-registration@example.edu',
        '2026-07-19T11:00:00Z', '2026-07-19T10:00:00Z')`,
  );
  await client.query(
    `insert into sessions (
       id, user_id, token_hash, idle_expires_at, absolute_expires_at,
       revoked_at, created_at, last_seen_at
     ) values
       ('018f0000-0000-7000-8000-000000004015', $1, 'old-session',
        '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z',
        '2026-05-01T00:00:00Z', '2026-04-01T00:00:00Z',
        '2026-05-01T00:00:00Z'),
       ('018f0000-0000-7000-8000-000000004016', $1, 'new-session',
        '2026-08-01T00:00:00Z', '2027-01-01T00:00:00Z',
        null, '2026-07-01T00:00:00Z', '2026-07-19T00:00:00Z')`,
    [USER_ID],
  );
  await client.query(
    `insert into operation_receipts (
       user_id, operation_id, request_digest, status, stable_result,
       created_at, expires_at
     ) values
       ($1, '018f0000-0000-7000-8000-000000004017', 'old', 'applied',
        '{}', '2026-01-01T00:00:00Z', '2026-07-18T00:00:00Z'),
       ($1, '018f0000-0000-7000-8000-000000004018', 'new', 'applied',
        '{}', '2026-07-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
    [USER_ID],
  );
  await client.query(
    `insert into rate_limit_counters (
       scope, subject_key, window_start, count, expires_at
     ) values
       ('test_old', 'subject', '2026-07-19T10:00:00Z', 1,
        '2026-07-19T10:01:00Z'),
       ('test_new', 'subject', '2026-07-19T11:59:00Z', 1,
        '2026-07-19T12:01:00Z')`,
  );
  await client.query(
    `insert into sync_events (
       event_id, scope, class_section_id, type, schema_version, payload,
       occurred_at
     ) values
       ('018f0000-0000-7000-8000-000000004019',
        'class_section_public', $1, 'old_event', 1, '{}',
        '2026-01-01T00:00:00Z'),
       ('018f0000-0000-7000-8000-000000004020',
        'class_section_public', $1, 'new_event', 1, '{}',
        '2026-07-01T00:00:00Z')`,
    [SECTION_ID],
  );
}

describePostgres('PostgresRetentionService', () => {
  let client: Client;
  let service: PostgresRetentionService;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    service = new PostgresRetentionService(client, { createId: ids() });
  });

  beforeEach(async () => {
    await client.query(`
      truncate table audit_log, operation_receipts, rate_limit_counters,
        sync_event_retention, sync_events, sessions, registration_tokens,
        auth_challenges,
        class_sections, courses, academic_terms, users restart identity cascade
    `);
    await seed(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('removes only expired data and advances the event watermark', async () => {
    const oldSequence = await client.query<{ sequence: string }>(
      `select sequence::text as sequence from sync_events
       where type = 'old_event'`,
    );
    const result = await service.runBatch({ now: NOW, limit: 100 });

    expect(result).toEqual({
      auth_challenges: 1,
      registration_tokens: 1,
      sessions: 1,
      operation_receipts: 1,
      rate_limit_counters: 1,
      sync_events: 1,
    });
    const counts = await client.query<{
      challenges: string;
      registrations: string;
      sessions: string;
      receipts: string;
      rate_limits: string;
      events: string;
      audits: string;
    }>(
      `select
         (select count(*) from auth_challenges)::text as challenges,
         (select count(*) from registration_tokens)::text as registrations,
         (select count(*) from sessions)::text as sessions,
         (select count(*) from operation_receipts)::text as receipts,
         (select count(*) from rate_limit_counters)::text as rate_limits,
         (select count(*) from sync_events)::text as events,
         (select count(*) from audit_log
          where action = 'retention_cleanup')::text as audits`,
    );
    expect(counts.rows[0]).toEqual({
      challenges: '1',
      registrations: '1',
      sessions: '1',
      receipts: '1',
      rate_limits: '1',
      events: '1',
      audits: '1',
    });
    const retention = await client.query<{ minimum_sequence: string }>(
      `select minimum_sequence::text as minimum_sequence
       from sync_event_retention where singleton_id = 1`,
    );
    expect(retention.rows[0]?.minimum_sequence).toBe(
      String(Number(oldSequence.rows[0]?.sequence ?? '0')),
    );
  });

  it('honors the per-table batch limit', async () => {
    const result = await service.runBatch({ now: NOW, limit: 1 });
    expect(Object.values(result).every((count) => count <= 1)).toBe(true);
  });
});
