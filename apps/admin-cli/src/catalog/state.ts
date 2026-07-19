import { readFile, rename, writeFile } from 'node:fs/promises';

import { z } from 'zod';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

const catalogImportStateSchema = z
  .object({
    schema_version: z.literal(1),
    import_id: z.uuid(),
    checksum: sha256Schema,
    manifest_hash: sha256Schema,
    environment: z.string().min(1).max(100),
    total_batches: z.number().int().positive(),
    next_plan_batch: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.next_plan_batch > value.total_batches) {
      context.addIssue({
        code: 'custom',
        path: ['next_plan_batch'],
        message: 'Next plan batch cannot exceed total batches.',
      });
    }
  });

export type CatalogImportState = z.infer<typeof catalogImportStateSchema>;

export async function readCatalogImportState(
  path: string,
): Promise<CatalogImportState | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }

  try {
    return catalogImportStateSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Error('Catalog import resume state is invalid.', { cause: error });
  }
}

export async function writeCatalogImportState(
  path: string,
  state: CatalogImportState,
): Promise<void> {
  const validated = catalogImportStateSchema.parse(state);
  const temporaryPath = `${path}.tmp-${String(process.pid)}`;
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}
