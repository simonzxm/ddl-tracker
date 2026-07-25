import { splitCatalogBatches, type CatalogBatch } from './batches.js';
import { parseCatalogCsv, type ParsedCatalogCsv } from './csv.js';
import { parseCatalogManifest, type CatalogManifest } from './manifest.js';

export interface PreparedCatalogData {
  manifest: CatalogManifest;
  parsed: ParsedCatalogCsv;
  batches: CatalogBatch[];
}

export interface CatalogUploadSource {
  filename: string;
  csvBytes: Uint8Array;
  manifestValue: unknown;
}

export function prepareCatalogImportData(input: {
  manifestValue: unknown;
  csvBytes: Uint8Array;
  maximumRecordsPerType?: number;
  maximumPayloadBytes?: number;
}): PreparedCatalogData {
  const manifest = parseCatalogManifest(input.manifestValue);
  const parsed = parseCatalogCsv(input.csvBytes, manifest);
  const batches = splitCatalogBatches(parsed.courses, parsed.class_sections, {
    maximumRecordsPerType: input.maximumRecordsPerType ?? 100,
    maximumPayloadBytes: input.maximumPayloadBytes ?? 420 * 1024,
  });
  return { manifest, parsed, batches };
}
