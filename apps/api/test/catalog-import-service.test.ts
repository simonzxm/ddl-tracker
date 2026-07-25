import { describe, expect, it } from 'vitest';

import type {
  CatalogImportDiff,
  CatalogPlanBatchRequest,
} from '@ddl-tracker/contracts';

import type { CatalogBaseline } from '../src/catalog/import-diff.js';
import {
  CatalogImportService,
  type CatalogImportBatchRecord,
  type CatalogImportRecord,
  type CatalogImportRepository,
  type CompleteCatalogPlan,
} from '../src/catalog/import-service.js';

const IMPORT_ID = '018f0000-0000-7000-8000-000000000501';
const ACTOR_ID = '018f0000-0000-7000-8000-000000000502';
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
        credits: null,
      },
    ],
    class_sections: [
      {
        external_section_id: 'section-1',
        external_course_code: '0010',
        name: 'Section',
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
        source_payload: {},
      },
    ],
    ...overrides,
  };
}

const emptyBaseline: CatalogBaseline = {
  term: null,
  courses: [],
  classSections: [],
};

class FakeImportRepository implements CatalogImportRepository {
  saveOutcome: 'accepted' | 'replayed' | 'metadata_conflict' | 'batch_conflict' =
    'accepted';
  record: CatalogImportRecord | null = null;
  batches: CatalogImportBatchRecord[] = [];
  baseline: CatalogBaseline = emptyBaseline;
  checksumPreviouslyApplied = false;
  completed: { baselineHash: string; diff: CatalogImportDiff } | null = null;
  completeInput: CompleteCatalogPlan | null = null;
  cancelOutcome: Awaited<ReturnType<CatalogImportRepository['cancel']>> = {
    kind: 'cancelled',
  };
  cancelInput: Parameters<CatalogImportRepository['cancel']>[0] | null = null;

  async savePlanBatch(input: {
    generatedImportId: string;
    actorId: string;
    request: CatalogPlanBatchRequest;
    batchChecksum: string;
    now: Date;
  }) {
    if (this.saveOutcome === 'metadata_conflict') {
      return { kind: 'metadata_conflict' as const };
    }
    if (this.saveOutcome === 'batch_conflict') {
      return { kind: 'batch_conflict' as const };
    }
    const id = input.request.import_id ?? input.generatedImportId;
    this.record ??= {
      id,
      actorId: input.actorId,
      checksum: input.request.checksum,
      headerHash: input.request.header_hash,
      manifestHash: input.request.manifest_hash,
      environment: input.request.environment,
      filename: input.request.filename,
      manifest: input.request.manifest,
      term: input.request.term,
      rowCount: input.request.row_count,
      totalBatches: input.request.total_batches,
      receivedBatches: 0,
      appliedBatches: 0,
      baselineHash: null,
      deactivationCount: 0,
      diff: null,
      status: 'planned',
      failureMessage: null,
    };
    if (this.saveOutcome === 'accepted') {
      this.batches.push({
        batchIndex: input.request.batch_index,
        batchChecksum: input.batchChecksum,
        courses: input.request.courses,
        classSections: input.request.class_sections,
        appliedAt: null,
      });
      this.record.receivedBatches = this.batches.length;
    }
    return {
      kind: this.saveOutcome,
      importRecord: this.record,
    } as const;
  }

  loadPlanningContext() {
    if (this.record === null) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      importRecord: this.record,
      batches: this.batches,
      baseline: this.baseline,
      checksumPreviouslyApplied: this.checksumPreviouslyApplied,
    });
  }

  getStatus(): Promise<CatalogImportRecord | null> {
    return Promise.resolve(this.record);
  }

  completePlan(
    _importId: string,
    baselineHash: string,
    diff: CatalogImportDiff,
  ): Promise<void> {
    this.completed = { baselineHash, diff };
    if (this.record !== null) {
      this.record.baselineHash = baselineHash;
      this.record.diff = diff;
      this.record.deactivationCount =
        diff.courses.deactivated + diff.class_sections.deactivated;
    }
    return Promise.resolve();
  }

  saveCompletePlan(input: CompleteCatalogPlan) {
    this.completeInput = input;
    const completeDiff: CatalogImportDiff = {
      terms: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
      courses: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
      class_sections: {
        added: 1,
        updated: 0,
        unchanged: 0,
        deactivated: 0,
      },
      field_changes: {},
      deactivated_courses: [],
      deactivated_class_sections: [],
      deactivated_class_section_ids: [],
      checksum_previously_applied: false,
    };
    const importRecord: CatalogImportRecord = {
      id: input.generatedImportId,
      actorId: input.actorId,
      checksum: input.checksum,
      headerHash: input.headerHash,
      manifestHash: input.manifestHash,
      environment: 'staging',
      filename: input.filename,
      manifest: input.manifest,
      term: input.term,
      rowCount: input.rowCount,
      totalBatches: input.batches.length,
      receivedBatches: input.batches.length,
      appliedBatches: 0,
      baselineHash: HASH,
      deactivationCount: 0,
      diff: completeDiff,
      status: 'planned',
      failureMessage: null,
    };
    this.record = importRecord;
    return Promise.resolve({
      importRecord,
      diff: completeDiff,
      replayed: false,
    });
  }

  cancel(input: Parameters<CatalogImportRepository['cancel']>[0]) {
    this.cancelInput = input;
    return Promise.resolve(this.cancelOutcome);
  }
}

function service(repository: FakeImportRepository): CatalogImportService {
  return new CatalogImportService({
    repository,
    createId: () => IMPORT_ID,
    now: () => NOW,
  });
}

describe('CatalogImportService status', () => {
  it('returns stable import progress and maps missing imports', async () => {
    const repository = new FakeImportRepository();
    repository.record = {
      id: IMPORT_ID,
      actorId: ACTOR_ID,
      checksum: HASH,
      headerHash: HASH,
      manifestHash: HASH,
      environment: 'staging',
      filename: 'fixture.csv',
      manifest: {},
      term: request().term,
      rowCount: 1,
      totalBatches: 2,
      receivedBatches: 1,
      appliedBatches: 0,
      baselineHash: null,
      deactivationCount: 0,
      diff: null,
      status: 'planned',
      failureMessage: null,
    };

    await expect(service(repository).getStatus(IMPORT_ID)).resolves.toEqual({
      import_id: IMPORT_ID,
      status: 'planned',
      received_batches: 1,
      applied_batches: 0,
      total_batches: 2,
      diff: null,
      failure_message: null,
    });

    repository.record = null;
    await expect(service(repository).getStatus(IMPORT_ID)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('CatalogImportService cancellation', () => {
  it('cancels a planned import and reports idempotent replays', async () => {
    const repository = new FakeImportRepository();
    await expect(
      service(repository).cancel(ACTOR_ID, IMPORT_ID, IMPORT_ID, {
        reason: 'Superseded upload',
      }),
    ).resolves.toEqual({
      import_id: IMPORT_ID,
      status: 'cancelled',
      replayed: false,
    });
    expect(repository.cancelInput).toMatchObject({
      actorId: ACTOR_ID,
      importId: IMPORT_ID,
      reason: 'Superseded upload',
      requestId: IMPORT_ID,
      now: NOW,
    });

    repository.cancelOutcome = { kind: 'replayed' };
    await expect(
      service(repository).cancel(ACTOR_ID, IMPORT_ID, IMPORT_ID, {
        reason: 'Superseded upload',
      }),
    ).resolves.toMatchObject({ replayed: true });
  });

  it('maps missing and terminal imports to stable errors', async () => {
    const repository = new FakeImportRepository();
    repository.cancelOutcome = { kind: 'not_found' };
    await expect(
      service(repository).cancel(ACTOR_ID, IMPORT_ID, IMPORT_ID, {
        reason: 'Superseded upload',
      }),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });

    repository.cancelOutcome = {
      kind: 'terminal_conflict',
      status: 'applied',
    };
    await expect(
      service(repository).cancel(ACTOR_ID, IMPORT_ID, IMPORT_ID, {
        reason: 'Superseded upload',
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
      details: { status: 'applied' },
    });
  });
});

describe('CatalogImportService plan batches', () => {
  it('accepts a first batch, builds a final diff, and binds its baseline', async () => {
    const repository = new FakeImportRepository();

    const response = await service(repository).planBatch(ACTOR_ID, request());

    expect(response).toMatchObject({
      import_id: IMPORT_ID,
      batch_index: 0,
      accepted: true,
      received_batches: 1,
      total_batches: 1,
      plan_complete: true,
      diff: {
        terms: { added: 1 },
        courses: { added: 1 },
        class_sections: { added: 1 },
      },
    });
    expect(repository.completed?.baselineHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('returns a stable replay for an identical batch', async () => {
    const repository = new FakeImportRepository();
    await service(repository).planBatch(ACTOR_ID, request());
    repository.saveOutcome = 'replayed';

    const replay = await service(repository).planBatch(
      ACTOR_ID,
      request({ import_id: IMPORT_ID }),
    );

    expect(replay.accepted).toBe(false);
    expect(replay.plan_complete).toBe(true);
    expect(replay.diff).not.toBeNull();
  });

  it('maps metadata and batch digest conflicts to stable errors', async () => {
    const metadata = new FakeImportRepository();
    metadata.saveOutcome = 'metadata_conflict';
    await expect(service(metadata).planBatch(ACTOR_ID, request())).rejects.toMatchObject({
      code: 'conflict',
    });

    const batch = new FakeImportRepository();
    batch.saveOutcome = 'batch_conflict';
    await expect(service(batch).planBatch(ACTOR_ID, request())).rejects.toMatchObject({
      code: 'operation_id_reused',
    });
  });

  it('does not finalize until every declared batch is present', async () => {
    const repository = new FakeImportRepository();
    const first = request({
      row_count: 2,
      total_batches: 2,
      finalize: false,
    });

    const response = await service(repository).planBatch(ACTOR_ID, first);

    expect(response.plan_complete).toBe(false);
    expect(response.diff).toBeNull();
    expect(repository.completed).toBeNull();
  });

  it('rejects finalization when uploaded section rows do not match row_count', async () => {
    const repository = new FakeImportRepository();

    await expect(
      service(repository).planBatch(ACTOR_ID, request({ row_count: 2 })),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('CatalogImportService gzip upload planning', () => {
  const headers = [
    'XNXQDM', 'XNXQDM_DISPLAY', 'KCH', 'KCM', 'XF', 'PKDWDM',
    'PKDWDM_DISPLAY', 'JXBID', 'JXBMC', 'KXH', 'SKJS', 'XXXQDM',
    'XXXQDM_DISPLAY', 'XKZRS', 'YPSJDD', 'SKZC', 'SKXQ', 'SKJC',
    'SKJAS', 'JXLDM', 'JXLDM_DISPLAY',
  ];
  const values = [
    '2026-2027-1', 'Term', '0010', 'Course', '3', '001', 'Department',
    'section-1', 'Section', '01', 'Teacher', '01', 'Campus', '30',
    'Thursday', '1-18', '4', '9-11', 'Room', 'B01', 'Building',
  ];
  const manifestValue = {
    schema_version: 1,
    source_system: 'test',
    term: {
      external_code: '2026-2027-1',
      display_name: 'Term',
      starts_on: '2026-08-31',
      ends_on: '2027-01-17',
      time_zone: 'Asia/Shanghai',
    },
  };

  it('validates normalized data and saves one complete plan', async () => {
    const repository = new FakeImportRepository();
    const response = await service(repository).upload(ACTOR_ID, IMPORT_ID, {
      filename: 'courses.csv.gz',
      manifestValue,
      csvBytes: new TextEncoder().encode(
        `${headers.join(',')}\n${values.join(',')}\n`,
      ),
    });

    expect(response).toMatchObject({
      import_id: IMPORT_ID,
      replayed: false,
      filename: 'courses.csv.gz',
      row_count: 1,
      course_count: 1,
      class_section_count: 1,
      total_batches: 1,
      warnings: [],
      diff: { courses: { added: 1 } },
    });
    expect(repository.completeInput).toMatchObject({
      actorId: ACTOR_ID,
      rowCount: 1,
      batches: [{ batchIndex: 0 }],
      requestId: IMPORT_ID,
    });
    expect(repository.completeInput?.batches[0]?.batchChecksum).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it('rejects malformed manifests before opening a plan', async () => {
    const repository = new FakeImportRepository();
    await expect(
      service(repository).upload(ACTOR_ID, IMPORT_ID, {
        filename: 'courses.csv.gz',
        manifestValue: {},
        csvBytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    expect(repository.completeInput).toBeNull();
  });
});
