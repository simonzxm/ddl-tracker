import { describe, expect, it, vi } from 'vitest';

import type { CatalogPlanBatchRequest } from '@ddl-tracker/contracts';

import {
  applyCatalogImport,
  planCatalogImport,
  prepareCatalogImport,
  type CatalogWorkflowClient,
} from '../src/catalog/workflow.js';

const IMPORT_ID = '018f0000-0000-7000-8000-000000001101';
const headers = [
  'XNXQDM',
  'XNXQDM_DISPLAY',
  'KCH',
  'KCM',
  'XF',
  'PKDWDM',
  'PKDWDM_DISPLAY',
  'JXBID',
  'JXBMC',
  'KXH',
  'SKJS',
  'XXXQDM',
  'XXXQDM_DISPLAY',
  'XKZRS',
  'YPSJDD',
  'SKZC',
  'SKXQ',
  'SKJC',
  'SKJAS',
  'JXLDM',
  'JXLDM_DISPLAY',
];

function csvRow(index: number): string {
  return [
    '2026-2027-1',
    'Term',
    String(index).padStart(4, '0'),
    `Course ${String(index)}`,
    '3.00',
    '001',
    'Department',
    `section-${String(index)}`,
    `Section ${String(index)}`,
    '01',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ].join(',');
}

function prepared() {
  return prepareCatalogImport({
    filename: 'fixture.csv',
    environment: 'staging',
    manifestValue: {
      schema_version: 1,
      source_system: 'test',
      term: {
        external_code: '2026-2027-1',
        display_name: 'Term',
        starts_on: '2026-08-31',
        ends_on: '2027-01-17',
        time_zone: 'Asia/Shanghai',
      },
    },
    csvBytes: new TextEncoder().encode(
      `${headers.join(',')}\n${csvRow(1)}\n${csvRow(2)}\n`,
    ),
    maximumPayloadBytes: 1_100,
  });
}

function client(): CatalogWorkflowClient & {
  applyAll: ReturnType<typeof vi.fn>;
  planBatch: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
} {
  return {
    planBatch: vi.fn(async (request: CatalogPlanBatchRequest) => ({
      import_id: IMPORT_ID,
      batch_index: request.batch_index,
      accepted: true,
      received_batches: request.batch_index + 1,
      total_batches: request.total_batches,
      plan_complete: request.finalize,
      diff: request.finalize
        ? {
            terms: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
            courses: { added: 2, updated: 0, unchanged: 0, deactivated: 0 },
            class_sections: {
              added: 2,
              updated: 0,
              unchanged: 0,
              deactivated: 0,
            },
            field_changes: {},
            deactivated_class_section_ids: [],
            checksum_previously_applied: false,
          }
        : null,
    })),
    applyAll: vi.fn(async () => ({
      import_id: IMPORT_ID,
      replayed: false,
      applied_batches: 2,
      total_batches: 2,
      complete: true,
    })),
    getStatus: vi.fn(async () => ({
      import_id: IMPORT_ID,
      status: 'planned' as const,
      received_batches: 2,
      applied_batches: 1,
      total_batches: 2,
      diff: {
        terms: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
        courses: { added: 2, updated: 0, unchanged: 0, deactivated: 0 },
        class_sections: {
          added: 2,
          updated: 0,
          unchanged: 0,
          deactivated: 0,
        },
        field_changes: {},
        deactivated_class_section_ids: [],
        checksum_previously_applied: false,
      },
      failure_message: null,
    })),
  };
}

describe('catalog workflow', () => {
  it('keeps default plan batches at most 100 courses and class sections', () => {
    const rows = Array.from({ length: 101 }, (_, index) => csvRow(index + 1));
    const result = prepareCatalogImport({
      filename: 'fixture.csv',
      environment: 'staging',
      manifestValue: {
        schema_version: 1,
        source_system: 'test',
        term: {
          external_code: '2026-2027-1',
          display_name: 'Term',
          starts_on: '2026-08-31',
          ends_on: '2027-01-17',
          time_zone: 'Asia/Shanghai',
        },
      },
      csvBytes: new TextEncoder().encode(
        `${headers.join(',')}\n${rows.join('\n')}\n`,
      ),
    });

    expect(result.batches).toHaveLength(2);
    expect(result.batches[0]?.courses).toHaveLength(100);
    expect(result.batches[0]?.class_sections).toHaveLength(100);
  });

  it('validates files and creates bounded deterministic plan batches', () => {
    const result = prepared();

    expect(result.parsed.metadata.row_count).toBe(2);
    expect(result.batches.length).toBeGreaterThan(1);
    expect(result.batches.flatMap((batch) => batch.class_sections)).toHaveLength(2);
  });

  it('plans every batch and reuses the returned import ID', async () => {
    const api = client();
    const progress: number[] = [];

    const result = await planCatalogImport(api, prepared(), {
      onProgress: ({ completed }) => {
        progress.push(completed);
      },
    });

    expect(result.importId).toBe(IMPORT_ID);
    expect(result.response.plan_complete).toBe(true);
    expect(api.planBatch).toHaveBeenCalledTimes(prepared().batches.length);
    const second = api.planBatch.mock.calls[1]?.[0] as
      | CatalogPlanBatchRequest
      | undefined;
    expect(second?.import_id).toBe(IMPORT_ID);
    expect(progress.at(-1)).toBe(prepared().batches.length);
  });

  it('resumes plan uploads from a stored batch index', async () => {
    const api = client();
    const input = prepared();

    await planCatalogImport(api, input, {
      importId: IMPORT_ID,
      startBatchIndex: 1,
    });

    expect(api.planBatch).toHaveBeenCalledTimes(input.batches.length - 1);
    const first = api.planBatch.mock.calls[0]?.[0] as
      | CatalogPlanBatchRequest
      | undefined;
    expect(first?.batch_index).toBe(1);
    expect(first?.import_id).toBe(IMPORT_ID);
  });

  it('applies the complete plan in one request', async () => {
    const api = client();

    const result = await applyCatalogImport(api, IMPORT_ID, {
      confirmDeactivations: true,
    });

    expect(api.applyAll).toHaveBeenCalledTimes(1);
    expect(api.applyAll).toHaveBeenCalledWith(IMPORT_ID, {
      confirm_deactivations: true,
    });
    expect(result.complete).toBe(true);
  });
});
