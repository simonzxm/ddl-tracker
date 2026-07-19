import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readCatalogImportState,
  writeCatalogImportState,
} from '../src/catalog/state.js';

const directories: string[] = [];
const IMPORT_ID = '018f0000-0000-7000-8000-000000001201';
const HASH = 'a'.repeat(64);

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ddl-tracker-state-'));
  directories.push(directory);
  return join(directory, 'state.json');
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('catalog import state', () => {
  it('writes and reads validated resume metadata without credentials', async () => {
    const path = await temporaryFile();
    await writeCatalogImportState(path, {
      schema_version: 1,
      import_id: IMPORT_ID,
      checksum: HASH,
      manifest_hash: HASH,
      environment: 'staging',
      total_batches: 3,
      next_plan_batch: 2,
    });

    await expect(readCatalogImportState(path)).resolves.toEqual({
      schema_version: 1,
      import_id: IMPORT_ID,
      checksum: HASH,
      manifest_hash: HASH,
      environment: 'staging',
      total_batches: 3,
      next_plan_batch: 2,
    });
    expect(await readFile(path, 'utf8')).not.toContain('token');
  });

  it('returns null when no resume file exists', async () => {
    await expect(readCatalogImportState(await temporaryFile())).resolves.toBeNull();
  });

  it('rejects corrupt or out-of-range state files', async () => {
    const path = await temporaryFile();
    await writeFile(path, '{', 'utf8');
    await expect(readCatalogImportState(path)).rejects.toThrow('resume state');

    await writeFile(
      path,
      JSON.stringify({
        schema_version: 1,
        import_id: IMPORT_ID,
        checksum: HASH,
        manifest_hash: HASH,
        environment: 'staging',
        total_batches: 1,
        next_plan_batch: 2,
      }),
      'utf8',
    );
    await expect(readCatalogImportState(path)).rejects.toThrow('resume state');
  });
});
