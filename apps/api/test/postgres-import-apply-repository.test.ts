import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CatalogImportDiff } from '@ddl-tracker/contracts';

import { hashCatalogBaseline } from '../src/catalog/import-diff.js';
import { PostgresCatalogImportApplyRepository } from '../src/catalog/postgres-import-apply-repository.js';
import { loadCatalogBaseline } from '../src/catalog/postgres-catalog-baseline.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const ACTOR_ID = '018f0000-0000-7000-8000-000000000801';
const IMPORT_ID = '018f0000-0000-7000-8000-000000000802';
const REQUEST_ID = '018f0000-0000-7000-8000-000000000803';
const TERM_ID = '018f0000-0000-7000-8000-000000000804';
const COURSE_ID = '018f0000-0000-7000-8000-000000000805';
const MISSING_COURSE_ID = '018f0000-0000-7000-8000-000000000806';
const SECTION_ID = '018f0000-0000-7000-8000-000000000807';
const MISSING_SECTION_ID = '018f0000-0000-7000-8000-000000000808';
const NOW = new Date('2026-07-19T12:00:00.000Z');

const desiredTerm = {
  external_code: '2026-2027-1',
  display_name: 'New Term',
  starts_on: '2026-08-31',
  ends_on: '2027-01-17',
  time_zone: 'Asia/Shanghai' as const,
};

const batchPayload = {
  courses: [
    {
      external_course_code: '0010',
      name: 'Updated Course',
      credits: '3.50',
    },
    {
      external_course_code: '0020',
      name: 'Added Course',
      credits: null,
    },
  ],
  class_sections: [
    {
      external_section_id: 'section-1',
      external_course_code: '0010',
      name: 'Section 1',
      section_number: '01',
      department_code: '002',
      department_name: 'New Department',
      instructors: ['Teacher'],
      campus_code: '01',
      campus_name: 'Campus',
      capacity: 30,
      schedule_text: 'New Schedule',
      weeks_text: null,
      weekday_text: null,
      periods_text: null,
      room_text: null,
      building_code: null,
      building_name: null,
      source_payload: { JXBID: 'section-1' },
    },
    {
      external_section_id: 'section-2',
      external_course_code: '0020',
      name: 'Section 2',
      section_number: '01',
      department_code: null,
      department_name: null,
      instructors: [],
      campus_code: null,
      campus_name: null,
      capacity: null,
      schedule_text: null,
      weeks_text: null,
      weekday_text: null,
      periods_text: null,
      room_text: null,
      building_code: null,
      building_name: null,
      source_payload: { JXBID: 'section-2' },
    },
  ],
};

const diff: CatalogImportDiff = {
  terms: { added: 0, updated: 1, unchanged: 0, deactivated: 0 },
  courses: { added: 1, updated: 1, unchanged: 0, deactivated: 1 },
  class_sections: { added: 1, updated: 1, unchanged: 0, deactivated: 1 },
  field_changes: {},
  deactivated_courses: [
    { id: MISSING_COURSE_ID, external_course_code: '0099' },
  ],
  deactivated_class_sections: [
    { id: MISSING_SECTION_ID, external_section_id: 'section-missing' },
  ],
  deactivated_class_section_ids: [MISSING_SECTION_ID],
  checksum_previously_applied: false,
};

async function seedCatalog(client: Client): Promise<string> {
  await client.query(
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values ($1, 'maintainer', 'maintainer', 'Maintainer', 'active', 1)`,
    [ACTOR_ID],
  );
  await client.query(
    `insert into academic_terms (
       id, external_term_code, name, starts_on, ends_on
     ) values ($1, '2026-2027-1', 'Old Term', '2026-08-31', '2027-01-17')`,
    [TERM_ID],
  );
  await client.query(
    `insert into courses (
       id, term_id, external_course_code, name, credits, active, revision
     ) values
       ($1, $3, '0010', 'Old Course', 3.00, true, 1),
       ($2, $3, '0099', 'Missing Course', null, true, 1)`,
    [COURSE_ID, MISSING_COURSE_ID, TERM_ID],
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number, instructors,
       department_code, department_name, campus, capacity, schedule_text,
       raw_source, active, revision
     ) values
       ($1, $3, 'section-1', '01', '["Teacher"]'::jsonb,
        '001', 'Old Department', 'Campus', 20, 'Old Schedule', '{}'::jsonb,
        true, 1),
       ($2, $3, 'section-missing', '02', '[]'::jsonb,
        null, null, null, null, null, '{}'::jsonb, true, 1)`,
    [SECTION_ID, MISSING_SECTION_ID, COURSE_ID],
  );
  return hashCatalogBaseline(
    await loadCatalogBaseline(client, desiredTerm.external_code),
  );
}

async function seedPlan(
  client: Client,
  baselineHash: string,
  options?: { totalBatches?: number; receivedBatches?: number },
): Promise<void> {
  const totalBatches = options?.totalBatches ?? 1;
  const receivedBatches = options?.receivedBatches ?? totalBatches;
  await client.query(
    `insert into catalog_imports (
       id, checksum, header_hash, manifest_hash, environment, filename,
       manifest, normalized_term, row_count, total_batches,
       received_batches, applied_batches, baseline_hash, deactivation_count,
       diff, actor_id, status, created_at, updated_at
     ) values (
       $1, $2, $2, $2, 'staging', 'fixture.csv', '{}'::jsonb, $3::jsonb,
       2, $4, $5, 0, $6, 2, $7::jsonb, $8, 'planned', $9, $9
     )`,
    [
      IMPORT_ID,
      'a'.repeat(64),
      JSON.stringify(desiredTerm),
      totalBatches,
      receivedBatches,
      baselineHash,
      JSON.stringify(diff),
      ACTOR_ID,
      NOW,
    ],
  );
  for (let index = 0; index < receivedBatches; index += 1) {
    await client.query(
      `insert into catalog_import_batches (
         import_id, batch_index, batch_checksum, payload, created_at
       ) values ($1, $2, $3, $4::jsonb, $5)`,
      [
        IMPORT_ID,
        index,
        String(index).padStart(64, 'b').slice(-64),
        JSON.stringify(index === 0 ? batchPayload : { courses: [], class_sections: [] }),
        NOW,
      ],
    );
  }
}

function idFactory(): () => string {
  const ids = [
    '018f0000-0000-7000-8000-000000000811',
    '018f0000-0000-7000-8000-000000000812',
    '018f0000-0000-7000-8000-000000000813',
    '018f0000-0000-7000-8000-000000000814',
    '018f0000-0000-7000-8000-000000000815',
  ];
  return () => {
    const id = ids.shift();
    if (id === undefined) throw new Error('No deterministic IDs left.');
    return id;
  };
}

describePostgres('PostgresCatalogImportApplyRepository', () => {
  let client: Client;
  let repository: PostgresCatalogImportApplyRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresCatalogImportApplyRepository(client, 'staging');
  });

  beforeEach(async () => {
    await client.query(`
      truncate table audit_log, sync_events, catalog_import_batches,
        catalog_imports, class_sections, courses, academic_terms, users cascade
    `);
  });

  afterAll(async () => {
    await client.end();
  });

  it('requires explicit confirmation before applying planned deactivations', async () => {
    const baselineHash = await seedCatalog(client);
    await seedPlan(client, baselineHash);

    await expect(
      repository.applyAll({
        actorId: ACTOR_ID,
        importId: IMPORT_ID,
        requestId: REQUEST_ID,
        confirmDeactivations: false,
        now: NOW,
        createId: idFactory(),
      }),
    ).resolves.toEqual({
      kind: 'deactivation_confirmation_required',
      count: 2,
    });

    const unchanged = await client.query<{ name: string }>(
      'select name from academic_terms where id = $1',
      [TERM_ID],
    );
    expect(unchanged.rows[0]?.name).toBe('Old Term');
  });

  it('rejects apply when the catalog changed after planning', async () => {
    const baselineHash = await seedCatalog(client);
    await seedPlan(client, baselineHash);
    await client.query(
      `update courses set name = 'Changed elsewhere', revision = revision + 1
       where id = $1`,
      [COURSE_ID],
    );

    await expect(
      repository.applyAll({
        actorId: ACTOR_ID,
        importId: IMPORT_ID,
        requestId: REQUEST_ID,
        confirmDeactivations: true,
        now: NOW,
        createId: idFactory(),
      }),
    ).resolves.toEqual({ kind: 'baseline_changed' });
  });

  it('applies, deactivates, emits tombstones and audit, then replays stably', async () => {
    const baselineHash = await seedCatalog(client);
    await seedPlan(client, baselineHash);
    const createId = idFactory();

    await expect(
      repository.applyAll({
        actorId: ACTOR_ID,
        importId: IMPORT_ID,
        requestId: REQUEST_ID,
        confirmDeactivations: true,
        now: NOW,
        createId,
      }),
    ).resolves.toEqual({
      kind: 'applied',
      appliedBatches: 1,
      totalBatches: 1,
      complete: true,
    });

    const term = await client.query<{ name: string }>(
      'select name from academic_terms where id = $1',
      [TERM_ID],
    );
    expect(term.rows[0]?.name).toBe('New Term');

    const courses = await client.query<{
      external_course_code: string;
      name: string;
      active: boolean;
      revision: number;
    }>(
      `select external_course_code, name, active, revision
       from courses where term_id = $1 order by external_course_code`,
      [TERM_ID],
    );
    expect(courses.rows).toEqual([
      {
        external_course_code: '0010',
        name: 'Updated Course',
        active: true,
        revision: 2,
      },
      {
        external_course_code: '0020',
        name: 'Added Course',
        active: true,
        revision: 1,
      },
      {
        external_course_code: '0099',
        name: 'Missing Course',
        active: false,
        revision: 2,
      },
    ]);

    const sections = await client.query<{
      external_section_id: string;
      department_code: string | null;
      department_name: string | null;
      capacity: number | null;
      active: boolean;
      revision: number;
    }>(
      `select external_section_id, department_code, department_name,
              capacity, active, revision
       from class_sections order by external_section_id`,
    );
    expect(sections.rows).toEqual([
      {
        external_section_id: 'section-1',
        department_code: '002',
        department_name: 'New Department',
        capacity: 30,
        active: true,
        revision: 2,
      },
      {
        external_section_id: 'section-2',
        department_code: null,
        department_name: null,
        capacity: null,
        active: true,
        revision: 1,
      },
      {
        external_section_id: 'section-missing',
        department_code: null,
        department_name: null,
        capacity: null,
        active: false,
        revision: 2,
      },
    ]);

    const events = await client.query<{ type: string; payload: unknown }>(
      'select type, payload from sync_events order by sequence',
    );
    expect(events.rows).toEqual([
      {
        type: 'class_section_deactivated',
        payload: {
          id: MISSING_SECTION_ID,
          external_section_id: 'section-missing',
          active: false,
          revision: 2,
          updated_at: NOW.toISOString(),
        },
      },
    ]);
    const audit = await client.query<{
      request_id: string;
      action: string;
    }>('select request_id, action from audit_log');
    expect(audit.rows).toEqual([
      { request_id: REQUEST_ID, action: 'catalog_import_applied' },
    ]);

    await expect(
      repository.applyAll({
        actorId: ACTOR_ID,
        importId: IMPORT_ID,
        requestId: REQUEST_ID,
        confirmDeactivations: true,
        now: NOW,
        createId,
      }),
    ).resolves.toEqual({
      kind: 'replayed',
      appliedBatches: 1,
      totalBatches: 1,
      complete: true,
    });
    const counts = await client.query<{ events: string; audits: string }>(
      `select
         (select count(*) from sync_events)::text as events,
         (select count(*) from audit_log)::text as audits`,
    );
    expect(counts.rows[0]).toEqual({ events: '1', audits: '1' });
  });

  it('atomically applies every uploaded batch', async () => {
    const baselineHash = await seedCatalog(client);
    await seedPlan(client, baselineHash, {
      totalBatches: 2,
      receivedBatches: 2,
    });
    const createId = idFactory();

    await expect(
      repository.applyAll({
        actorId: ACTOR_ID,
        importId: IMPORT_ID,
        requestId: '018f0000-0000-7000-8000-000000000809',
        confirmDeactivations: true,
        now: NOW,
        createId,
      }),
    ).resolves.toEqual({
      kind: 'applied',
      appliedBatches: 2,
      totalBatches: 2,
      complete: true,
    });

    const state = await client.query<{
      status: string;
      applied_batches: number;
      pending_batches: string;
    }>(
      `select i.status, i.applied_batches,
              count(*) filter (where b.applied_at is null)::text as pending_batches
       from catalog_imports i
       join catalog_import_batches b on b.import_id = i.id
       where i.id = $1
       group by i.id`,
      [IMPORT_ID],
    );
    expect(state.rows[0]).toEqual({
      status: 'applied',
      applied_batches: 2,
      pending_batches: '0',
    });
  });

  it('rolls back every catalog and import write when the final audit fails', async () => {
    const baselineHash = await seedCatalog(client);
    await seedPlan(client, baselineHash);

    await expect(
      repository.applyAll({
        actorId: ACTOR_ID,
        importId: IMPORT_ID,
        requestId: 'not-a-uuid',
        confirmDeactivations: true,
        now: NOW,
        createId: idFactory(),
      }),
    ).rejects.toThrow();

    const state = await client.query<{
      term_name: string;
      course_name: string;
      missing_course_active: boolean;
      added_courses: string;
      section_department: string;
      missing_section_active: boolean;
      added_sections: string;
      import_status: string;
      applied_batches: number;
      applied_batch_rows: string;
      events: string;
      audits: string;
    }>(
      `select
         (select name from academic_terms where id = $1) as term_name,
         (select name from courses where id = $2) as course_name,
         (select active from courses where id = $3) as missing_course_active,
         (select count(*) from courses
          where external_course_code = '0020')::text as added_courses,
         (select department_name from class_sections
          where id = $4) as section_department,
         (select active from class_sections
          where id = $5) as missing_section_active,
         (select count(*) from class_sections
          where external_section_id = 'section-2')::text as added_sections,
         (select status from catalog_imports
          where id = $6) as import_status,
         (select applied_batches from catalog_imports
          where id = $6) as applied_batches,
         (select count(*) from catalog_import_batches
          where import_id = $6 and applied_at is not null)::text
           as applied_batch_rows,
         (select count(*) from sync_events)::text as events,
         (select count(*) from audit_log)::text as audits`,
      [
        TERM_ID,
        COURSE_ID,
        MISSING_COURSE_ID,
        SECTION_ID,
        MISSING_SECTION_ID,
        IMPORT_ID,
      ],
    );
    expect(state.rows[0]).toEqual({
      term_name: 'Old Term',
      course_name: 'Old Course',
      missing_course_active: true,
      added_courses: '0',
      section_department: 'Old Department',
      missing_section_active: true,
      added_sections: '0',
      import_status: 'planned',
      applied_batches: 0,
      applied_batch_rows: '0',
      events: '0',
      audits: '0',
    });
  });

  it('rejects an incomplete plan', async () => {
    const baselineHash = await seedCatalog(client);
    await seedPlan(client, baselineHash, { totalBatches: 2, receivedBatches: 1 });
    await expect(
      repository.applyAll({
        actorId: ACTOR_ID,
        importId: IMPORT_ID,
        requestId: REQUEST_ID,
        confirmDeactivations: true,
        now: NOW,
        createId: idFactory(),
      }),
    ).resolves.toEqual({ kind: 'plan_incomplete' });
  });
});
