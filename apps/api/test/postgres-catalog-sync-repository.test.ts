import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedCatalogCsv } from '@ddl-tracker/catalog-sync';

import { PostgresCatalogSyncRepository } from '../src/catalog/postgres-catalog-sync-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const TERM_ID = '018f0000-0000-7000-8000-000000000901';
const COURSE_ID = '018f0000-0000-7000-8000-000000000902';
const MISSING_COURSE_ID = '018f0000-0000-7000-8000-000000000903';
const SECTION_ID = '018f0000-0000-7000-8000-000000000904';
const MISSING_SECTION_ID = '018f0000-0000-7000-8000-000000000905';
const RUN_ID = '018f0000-0000-7000-8000-000000000906';
const NOW = new Date('2026-08-06T08:00:00.000Z');
const REPOSITORY = 'at-nju/courses';
const COMMIT = 'c0c3db8d883385e9f9868ac04cc72ef64482f52d';
const BLOB = 'a'.repeat(40);

const catalog: ParsedCatalogCsv = {
  metadata: {
    checksum: 'b'.repeat(64),
    row_count: 2,
    header_hash: 'c'.repeat(64),
    warnings: [],
  },
  term: {
    external_code: '2026-2027-1',
    display_name: 'New Term',
    starts_on: null,
    ends_on: null,
    time_zone: 'Asia/Shanghai',
  },
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

function idFactory(): () => string {
  const ids = [
    '018f0000-0000-7000-8000-000000000911',
    '018f0000-0000-7000-8000-000000000912',
    '018f0000-0000-7000-8000-000000000913',
    '018f0000-0000-7000-8000-000000000914',
    '018f0000-0000-7000-8000-000000000915',
    '018f0000-0000-7000-8000-000000000916',
    '018f0000-0000-7000-8000-000000000917',
  ];
  return () => {
    const id = ids.shift();
    if (id === undefined) throw new Error('No deterministic IDs left.');
    return id;
  };
}

async function seedCatalog(client: Client): Promise<void> {
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
}

function applyInput(runId = RUN_ID) {
  return {
    runId,
    repository: REPOSITORY,
    commitSha: COMMIT,
    source: {
      termCode: '2026-2027-1',
      path: 'data/2026-2027-1/courses.csv.gz',
      blobSha: BLOB,
      compressedBytes: 100,
    },
    catalog,
    startedAt: new Date('2026-08-06T07:59:00.000Z'),
    completedAt: NOW,
  };
}

describePostgres('PostgresCatalogSyncRepository', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query(`
      truncate table catalog_sync_state, catalog_sync_runs, audit_log,
        sync_events, class_sections, courses, academic_terms cascade
    `);
    await client.query(
      `update catalog_revision
       set revision = 1, updated_at = '2026-08-06T00:00:00Z'
       where singleton_id = 1`,
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it('atomically upserts one term, deactivates missing records, and records source state', async () => {
    await seedCatalog(client);
    const repository = new PostgresCatalogSyncRepository(client, {
      createId: idFactory(),
    });

    await expect(repository.apply(applyInput())).resolves.toEqual({
      changed: true,
    });

    const term = await client.query<{
      name: string;
      starts_on: string | null;
      ends_on: string | null;
    }>(
      `select name, starts_on::text, ends_on::text
       from academic_terms where id = $1`,
      [TERM_ID],
    );
    expect(term.rows[0]).toEqual({
      name: 'New Term',
      starts_on: '2026-08-31',
      ends_on: '2027-01-17',
    });

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
      department_name: string | null;
      active: boolean;
      revision: number;
    }>(
      `select external_section_id, department_name, active, revision
       from class_sections order by external_section_id`,
    );
    expect(sections.rows).toEqual([
      {
        external_section_id: 'section-1',
        department_name: 'New Department',
        active: true,
        revision: 2,
      },
      {
        external_section_id: 'section-2',
        department_name: null,
        active: true,
        revision: 1,
      },
      {
        external_section_id: 'section-missing',
        department_name: null,
        active: false,
        revision: 2,
      },
    ]);

    const state = await client.query<{
      term_code: string;
      commit_sha: string;
      blob_sha: string;
      run_id: string;
    }>('select term_code, commit_sha, blob_sha, run_id from catalog_sync_state');
    expect(state.rows).toEqual([
      {
        term_code: '2026-2027-1',
        commit_sha: COMMIT,
        blob_sha: BLOB,
        run_id: RUN_ID,
      },
    ]);
    const run = await client.query<{
      status: string;
      changed: boolean;
      row_count: number;
      course_count: number;
      class_section_count: number;
    }>(
      `select status, changed, row_count, course_count, class_section_count
       from catalog_sync_runs where id = $1`,
      [RUN_ID],
    );
    expect(run.rows[0]).toEqual({
      status: 'succeeded',
      changed: true,
      row_count: 2,
      course_count: 2,
      class_section_count: 2,
    });

    const events = await client.query<{ type: string }>(
      'select type from sync_events order by sequence',
    );
    expect(events.rows).toEqual([
      { type: 'class_section_deactivated' },
      { type: 'catalog_revision_changed' },
    ]);
  });

  it('does not advance the catalog revision for a new source blob with identical normalized data', async () => {
    const repository = new PostgresCatalogSyncRepository(client, {
      createId: idFactory(),
    });
    await repository.apply(applyInput());
    const second = applyInput('018f0000-0000-7000-8000-000000000907');
    second.source = { ...second.source, blobSha: 'd'.repeat(40) };

    await expect(repository.apply(second)).resolves.toEqual({ changed: false });

    const revision = await client.query<{ revision: number }>(
      'select revision from catalog_revision where singleton_id = 1',
    );
    expect(revision.rows[0]?.revision).toBe(2);
    const events = await client.query<{ count: string }>(
      'select count(*)::text as count from sync_events',
    );
    expect(events.rows[0]?.count).toBe('1');
    await expect(repository.currentBlobShas(REPOSITORY)).resolves.toEqual(
      new Map([['2026-2027-1', 'd'.repeat(40)]]),
    );
  });

  it('records failed source attempts without changing current state', async () => {
    const repository = new PostgresCatalogSyncRepository(client, {
      createId: idFactory(),
    });
    await repository.recordFailure({
      runId: RUN_ID,
      repository: REPOSITORY,
      commitSha: COMMIT,
      source: applyInput().source,
      errorMessage: 'CSV invalid',
      startedAt: new Date('2026-08-06T07:59:00.000Z'),
      completedAt: NOW,
    });

    const result = await client.query<{
      status: string;
      error_message: string | null;
      states: string;
    }>(
      `select status, error_message,
              (select count(*) from catalog_sync_state)::text as states
       from catalog_sync_runs where id = $1`,
      [RUN_ID],
    );
    expect(result.rows[0]).toEqual({
      status: 'failed',
      error_message: 'CSV invalid',
      states: '0',
    });
  });

  it('rolls back the full term when an existing section would move courses', async () => {
    await seedCatalog(client);
    const otherTermId = '018f0000-0000-7000-8000-000000000920';
    const otherCourseId = '018f0000-0000-7000-8000-000000000921';
    await client.query(
      `insert into academic_terms (id, external_term_code, name)
       values ($1, '2025-2026-2', 'Other Term')`,
      [otherTermId],
    );
    await client.query(
      `insert into courses (id, term_id, external_course_code, name)
       values ($1, $2, 'other', 'Other Course')`,
      [otherCourseId, otherTermId],
    );
    await client.query(
      `update class_sections set course_id = $1 where id = $2`,
      [otherCourseId, SECTION_ID],
    );
    const repository = new PostgresCatalogSyncRepository(client, {
      createId: idFactory(),
    });

    await expect(repository.apply(applyInput())).rejects.toThrow(
      'cannot move between courses',
    );

    const state = await client.query<{
      term_name: string;
      runs: string;
      states: string;
    }>(
      `select
         (select name from academic_terms where id = $1) as term_name,
         (select count(*) from catalog_sync_runs)::text as runs,
         (select count(*) from catalog_sync_state)::text as states`,
      [TERM_ID],
    );
    expect(state.rows[0]).toEqual({
      term_name: 'Old Term',
      runs: '0',
      states: '0',
    });
  });
});
