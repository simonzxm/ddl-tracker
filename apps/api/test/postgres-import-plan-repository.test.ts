import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  CatalogImportDiff,
  CatalogPlanBatchRequest,
} from '@ddl-tracker/contracts';

import { PostgresCatalogImportRepository } from '../src/catalog/postgres-import-plan-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const IMPORT_ID = '018f0000-0000-7000-8000-000000000601';
const ACTOR_ID = '018f0000-0000-7000-8000-000000000602';
const TERM_ID = '018f0000-0000-7000-8000-000000000603';
const COURSE_ID = '018f0000-0000-7000-8000-000000000604';
const SECTION_ID = '018f0000-0000-7000-8000-000000000605';
const HASH = 'a'.repeat(64);
const NOW = new Date('2026-07-19T12:00:00.000Z');

function request(
  overrides: Partial<CatalogPlanBatchRequest> = {},
): CatalogPlanBatchRequest {
  return {
    import_id: null,
    filename: 'fixture.csv',
    checksum: HASH,
    header_hash: HASH,
    manifest_hash: HASH,
    environment: 'staging',
    manifest: { schema_version: 1 },
    term: {
      external_code: '2026-2027-1',
      display_name: 'Term',
      starts_on: '2026-08-31',
      ends_on: '2027-01-17',
      time_zone: 'Asia/Shanghai',
    },
    row_count: 1,
    batch_index: 0,
    total_batches: 1,
    finalize: true,
    courses: [
      {
        external_course_code: '0010',
        name: 'Course',
        credits: '3.00',
      },
    ],
    class_sections: [
      {
        external_section_id: 'section-1',
        external_course_code: '0010',
        name: 'Section',
        section_number: '01',
        department_code: '001',
        department_name: 'Department',
        instructors: ['Teacher'],
        campus_code: '01',
        campus_name: 'Campus',
        capacity: 30,
        schedule_text: 'Thursday',
        weeks_text: null,
        weekday_text: null,
        periods_text: null,
        room_text: null,
        building_code: null,
        building_name: null,
        source_payload: { KCH: '0010' },
      },
    ],
    ...overrides,
  };
}

const diff: CatalogImportDiff = {
  terms: { added: 0, updated: 1, unchanged: 0, deactivated: 0 },
  courses: { added: 0, updated: 0, unchanged: 1, deactivated: 0 },
  class_sections: { added: 0, updated: 1, unchanged: 0, deactivated: 0 },
  field_changes: { 'terms.name': 1 },
  deactivated_class_section_ids: [],
  checksum_previously_applied: false,
};

describePostgres('PostgresCatalogImportRepository planning', () => {
  let client: Client;
  let repository: PostgresCatalogImportRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresCatalogImportRepository(client, 'staging');
  });

  beforeEach(async () => {
    await client.query(`
      truncate table catalog_import_batches, catalog_imports, class_sections,
        courses, academic_terms, users cascade
    `);
    await client.query(
      `insert into users (
         id, username, username_key, display_name, status, profile_revision
       ) values ($1, 'maintainer', 'maintainer', 'Maintainer', 'active', 1)`,
      [ACTOR_ID],
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it('stores a first batch, replays the same checksum, and rejects conflicts', async () => {
    await expect(
      repository.savePlanBatch({
        generatedImportId: IMPORT_ID,
        actorId: ACTOR_ID,
        request: request(),
        batchChecksum: 'b'.repeat(64),
        now: NOW,
      }),
    ).resolves.toMatchObject({
      kind: 'accepted',
      importRecord: { id: IMPORT_ID, receivedBatches: 1 },
    });

    await expect(
      repository.savePlanBatch({
        generatedImportId: '018f0000-0000-7000-8000-000000000606',
        actorId: ACTOR_ID,
        request: request({ import_id: IMPORT_ID }),
        batchChecksum: 'b'.repeat(64),
        now: NOW,
      }),
    ).resolves.toMatchObject({ kind: 'replayed' });

    await expect(
      repository.savePlanBatch({
        generatedImportId: '018f0000-0000-7000-8000-000000000607',
        actorId: ACTOR_ID,
        request: request({ import_id: IMPORT_ID }),
        batchChecksum: 'c'.repeat(64),
        now: NOW,
      }),
    ).resolves.toEqual({ kind: 'batch_conflict' });

    await expect(
      repository.savePlanBatch({
        generatedImportId: '018f0000-0000-7000-8000-000000000608',
        actorId: ACTOR_ID,
        request: request({ import_id: IMPORT_ID, filename: 'other.csv' }),
        batchChecksum: 'b'.repeat(64),
        now: NOW,
      }),
    ).resolves.toEqual({ kind: 'metadata_conflict' });
  });

  it('isolates plan continuation and status by server environment', async () => {
    await repository.savePlanBatch({
      generatedImportId: IMPORT_ID,
      actorId: ACTOR_ID,
      request: request(),
      batchChecksum: 'b'.repeat(64),
      now: NOW,
    });
    const production = new PostgresCatalogImportRepository(client, 'production');

    await expect(production.getStatus(IMPORT_ID)).resolves.toBeNull();
    await expect(
      production.savePlanBatch({
        generatedImportId: '018f0000-0000-7000-8000-000000000609',
        actorId: ACTOR_ID,
        request: request({ import_id: IMPORT_ID }),
        batchChecksum: 'b'.repeat(64),
        now: NOW,
      }),
    ).resolves.toEqual({ kind: 'metadata_conflict' });
  });

  it('loads ordered batches and the current term baseline, then finalizes stably', async () => {
    await client.query(
      `insert into academic_terms (
         id, external_term_code, name, starts_on, ends_on
       ) values ($1, '2026-2027-1', 'Old Term', '2026-08-31', '2027-01-17')`,
      [TERM_ID],
    );
    await client.query(
      `insert into courses (
         id, term_id, external_course_code, name, credits, department,
         active, revision
       ) values ($1, $2, '0010', 'Course', 3.00, 'Department', true, 2)`,
      [COURSE_ID, TERM_ID],
    );
    await client.query(
      `insert into class_sections (
         id, course_id, external_section_id, section_number, instructors,
         campus, capacity, schedule_text, active, revision
       ) values ($1, $2, 'section-1', '01', '["Teacher"]'::jsonb,
                 'Campus', 20, 'Old Thursday', true, 3)`,
      [SECTION_ID, COURSE_ID],
    );
    await repository.savePlanBatch({
      generatedImportId: IMPORT_ID,
      actorId: ACTOR_ID,
      request: request(),
      batchChecksum: 'b'.repeat(64),
      now: NOW,
    });

    const context = await repository.loadPlanningContext(IMPORT_ID);

    expect(context).toMatchObject({
      importRecord: {
        id: IMPORT_ID,
        term: { external_code: '2026-2027-1' },
      },
      batches: [{ batchIndex: 0 }],
      baseline: {
        term: { id: TERM_ID, name: 'Old Term' },
        courses: [{ id: COURSE_ID, revision: 2 }],
        classSections: [{ id: SECTION_ID, revision: 3 }],
      },
      checksumPreviouslyApplied: false,
    });

    await repository.completePlan(IMPORT_ID, 'd'.repeat(64), diff, NOW);
    await expect(
      repository.completePlan(IMPORT_ID, 'd'.repeat(64), diff, NOW),
    ).resolves.toBeUndefined();

    const stored = await client.query<{
      baseline_hash: string;
      deactivation_count: number;
      diff: unknown;
    }>(
      `select baseline_hash, deactivation_count, diff
       from catalog_imports where id = $1`,
      [IMPORT_ID],
    );
    expect(stored.rows[0]).toMatchObject({
      baseline_hash: 'd'.repeat(64),
      deactivation_count: 0,
      diff,
    });
  });
});
