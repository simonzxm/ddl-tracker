import { z } from 'zod';

export const apiContractVersionSchema = z.enum(['1.0.0', '1.1.0']);
export type ApiContractVersion = z.infer<typeof apiContractVersionSchema>;

export const API_CONTRACT_VERSION: ApiContractVersion = '1.1.0';

const apiCapabilitySchema = z.enum([
  'catalog_plan_batches',
  'catalog_apply_all',
  'catalog_import_status',
  'catalog_gzip_upload',
  'catalog_import_cancel',
  'catalog_terminal_expiry',
  'catalog_deactivation_identifiers',
  'catalog_upload_replay',
]);

const catalogImportStatusValueSchema = z.enum([
  'planned',
  'applied',
  'failed',
  'cancelled',
  'expired',
]);

const compatibilityRequirementSchema = z.enum([
  'ignore_additive_response_fields',
  'accept_new_terminal_statuses',
  'fallback_to_plan_batches',
  'avoid_1_1_only_endpoints',
  'accept_missing_1_1_response_fields',
]);

const contractReleaseSchema = z
  .object({
    capabilities: z.array(apiCapabilitySchema).min(1),
    catalog_import_status_values: z
      .array(catalogImportStatusValueSchema)
      .min(1),
  })
  .strict();

const compatibilityPairSchema = z
  .object({
    client_version: apiContractVersionSchema,
    server_version: apiContractVersionSchema,
    compatibility: z.enum(['full', 'conditional']),
    requirements: z.array(compatibilityRequirementSchema),
  })
  .strict();

export const apiCompatibilityMatrixSchema = z
  .object({
    schema_version: z.literal(1),
    current_server_version: apiContractVersionSchema,
    versions: z
      .object({
        '1.0.0': contractReleaseSchema,
        '1.1.0': contractReleaseSchema,
      })
      .strict(),
    matrix: z.array(compatibilityPairSchema).length(4),
  })
  .strict();

export type ApiCompatibilityMatrix = z.infer<
  typeof apiCompatibilityMatrixSchema
>;
