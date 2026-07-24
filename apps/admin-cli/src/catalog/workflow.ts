import type {
  CatalogApplyAllRequest,
  CatalogImportDiff,
  CatalogPlanBatchRequest,
} from '@ddl-tracker/contracts';

import { splitCatalogBatches, type CatalogBatch } from './batches.js';
import { parseCatalogCsv, type ParsedCatalogCsv } from './csv.js';
import {
  parseCatalogManifest,
  type CatalogManifest,
} from './manifest.js';

export interface CatalogPlanResponse {
  import_id: string;
  batch_index: number;
  accepted: boolean;
  received_batches: number;
  total_batches: number;
  plan_complete: boolean;
  diff: CatalogImportDiff | null;
}

export interface CatalogApplyResponse {
  import_id: string;
  replayed: boolean;
  applied_batches: number;
  total_batches: number;
  complete: boolean;
}

export interface CatalogStatusResponse {
  import_id: string;
  status: 'planned' | 'applied' | 'failed';
  received_batches: number;
  applied_batches: number;
  total_batches: number;
  diff: CatalogImportDiff | null;
  failure_message: string | null;
}

export interface CatalogWorkflowClient {
  planBatch(request: CatalogPlanBatchRequest): Promise<CatalogPlanResponse>;
  applyAll(
    importId: string,
    request: CatalogApplyAllRequest,
  ): Promise<CatalogApplyResponse>;
  getStatus(importId: string): Promise<CatalogStatusResponse>;
}

export interface PreparedCatalogImport {
  filename: string;
  environment: string;
  manifest: CatalogManifest;
  parsed: ParsedCatalogCsv;
  batches: CatalogBatch[];
}

export function prepareCatalogImport(input: {
  filename: string;
  environment: string;
  manifestValue: unknown;
  csvBytes: Uint8Array;
  maximumPayloadBytes?: number;
}): PreparedCatalogImport {
  const manifest = parseCatalogManifest(input.manifestValue);
  const parsed = parseCatalogCsv(input.csvBytes, manifest);
  const batches = splitCatalogBatches(
    parsed.courses,
    parsed.class_sections,
    {
      maximumRecordsPerType: 100,
      maximumPayloadBytes: input.maximumPayloadBytes ?? 420 * 1024,
    },
  );
  return {
    filename: input.filename,
    environment: input.environment,
    manifest,
    parsed,
    batches,
  };
}

export async function planCatalogImport(
  client: CatalogWorkflowClient,
  prepared: PreparedCatalogImport,
  options: {
    importId?: string;
    startBatchIndex?: number;
    onProgress?: (progress: {
      completed: number;
      total: number;
      importId: string;
    }) => void | Promise<void>;
  } = {},
): Promise<{ importId: string; response: CatalogPlanResponse }> {
  const startBatchIndex = options.startBatchIndex ?? 0;
  if (
    !Number.isInteger(startBatchIndex) ||
    startBatchIndex < 0 ||
    startBatchIndex >= prepared.batches.length
  ) {
    throw new Error('Plan resume batch index is invalid.');
  }
  if (startBatchIndex > 0 && options.importId === undefined) {
    throw new Error('Plan resume requires an import ID.');
  }

  let importId = options.importId;
  let lastResponse: CatalogPlanResponse | undefined;
  for (
    let batchIndex = startBatchIndex;
    batchIndex < prepared.batches.length;
    batchIndex += 1
  ) {
    const batch = prepared.batches[batchIndex];
    if (batch === undefined) {
      throw new Error('Catalog batch disappeared during planning.');
    }
    const response = await client.planBatch({
      import_id: batchIndex === 0 ? null : (importId ?? null),
      filename: prepared.filename,
      checksum: prepared.parsed.metadata.checksum,
      header_hash: prepared.parsed.metadata.header_hash,
      manifest_hash: prepared.parsed.metadata.manifest_hash,
      environment: prepared.environment,
      manifest: prepared.manifest,
      term: prepared.parsed.term,
      row_count: prepared.parsed.metadata.row_count,
      batch_index: batchIndex,
      total_batches: prepared.batches.length,
      finalize: batchIndex === prepared.batches.length - 1,
      courses: batch.courses,
      class_sections: batch.class_sections,
    });
    if (importId !== undefined && response.import_id !== importId) {
      throw new Error('API changed the catalog import ID during upload.');
    }
    importId = response.import_id;
    lastResponse = response;
    await options.onProgress?.({
      completed: batchIndex + 1,
      total: prepared.batches.length,
      importId,
    });
  }

  if (importId === undefined || lastResponse === undefined) {
    throw new Error('Catalog plan produced no response.');
  }
  return { importId, response: lastResponse };
}

export async function applyCatalogImport(
  client: CatalogWorkflowClient,
  importId: string,
  options: {
    confirmDeactivations: boolean;
    onProgress?: (progress: {
      completed: number;
      total: number;
      importId: string;
    }) => void | Promise<void>;
  },
): Promise<CatalogApplyResponse> {
  const status = await client.getStatus(importId);
  if (status.status === 'failed') {
    throw new Error(status.failure_message ?? 'Catalog import previously failed.');
  }
  if (status.status === 'applied') {
    return {
      import_id: importId,
      replayed: true,
      applied_batches: status.applied_batches,
      total_batches: status.total_batches,
      complete: true,
    };
  }
  if (status.diff === null || status.received_batches !== status.total_batches) {
    throw new Error('Catalog import plan is not complete.');
  }

  const response = await client.applyAll(importId, {
    confirm_deactivations: options.confirmDeactivations,
  });
  await options.onProgress?.({
    completed: response.applied_batches,
    total: response.total_batches,
    importId,
  });
  return response;
}
