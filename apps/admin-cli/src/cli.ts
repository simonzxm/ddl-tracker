import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { Command } from 'commander';

import type {
  CatalogCancelRequest,
  CatalogCancelResponse,
  CatalogUploadResponse,
} from '@ddl-tracker/contracts';

import { AdminApiClient } from './api-client.js';
import {
  applyCatalogImport,
  planCatalogImport,
  prepareCatalogImport,
  type CatalogWorkflowClient,
} from './catalog/workflow.js';
import {
  readCatalogImportState,
  writeCatalogImportState,
} from './catalog/state.js';

const gunzipAsync = promisify(gunzip);

export interface AdminCatalogClient extends CatalogWorkflowClient {
  upload(input: {
    filename: string;
    catalogGzip: Uint8Array;
    manifestJson: string;
  }): Promise<CatalogUploadResponse>;
  cancel(
    importId: string,
    request: CatalogCancelRequest,
  ): Promise<CatalogCancelResponse>;
}

async function decodeCatalogCsv(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return bytes;
  }
  return new Uint8Array(await gunzipAsync(bytes));
}

export interface CliDependencies {
  env: NodeJS.ProcessEnv;
  readTextFile(path: string): Promise<string>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeLine(value: string): void;
  prompt(value: string): Promise<string>;
  createClient(options: {
    baseUrl: string;
    token: string;
  }): AdminCatalogClient;
}

function defaultDependencies(): CliDependencies {
  return {
    env: process.env,
    readTextFile: (path) => readFile(path, 'utf8'),
    readBinaryFile: async (path) => new Uint8Array(await readFile(path)),
    writeLine: (value) => { console.log(value); },
    prompt: async (value) => {
      const reader = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await reader.question(value);
      } finally {
        reader.close();
      }
    },
    createClient: ({ baseUrl, token }) =>
      new AdminApiClient({ baseUrl, token }),
  };
}

function requiredToken(
  dependencies: CliDependencies,
  tokenEnvironmentVariable: string,
): string {
  const token = dependencies.env[tokenEnvironmentVariable];
  if (token === undefined || token.length === 0) {
    throw new Error(
      `Missing admin token in environment variable ${tokenEnvironmentVariable}.`,
    );
  }
  return token;
}

async function prepareFromFiles(
  dependencies: CliDependencies,
  options: {
    csvPath: string;
    manifestPath: string;
    environment: string;
  },
) {
  const [manifestText, sourceBytes] = await Promise.all([
    dependencies.readTextFile(options.manifestPath),
    dependencies.readBinaryFile(options.csvPath),
  ]);
  const csvBytes = await decodeCatalogCsv(sourceBytes);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestText);
  } catch (error) {
    throw new Error('Catalog manifest must contain valid JSON.', {
      cause: error,
    });
  }
  return prepareCatalogImport({
    filename: basename(options.csvPath),
    environment: options.environment,
    manifestValue,
    csvBytes,
  });
}

function assertResumeMatches(
  state: NonNullable<Awaited<ReturnType<typeof readCatalogImportState>>>,
  prepared: Awaited<ReturnType<typeof prepareFromFiles>>,
): void {
  if (
    state.checksum !== prepared.parsed.metadata.checksum ||
    state.manifest_hash !== prepared.parsed.metadata.manifest_hash ||
    state.environment !== prepared.environment ||
    state.total_batches !== prepared.batches.length
  ) {
    throw new Error('Resume state does not match the current catalog files.');
  }
}

export function createProgram(
  overrides: Partial<CliDependencies> = {},
): Command {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const program = new Command();
  program
    .name('ddl-tracker-admin')
    .description('DDL Tracker maintainer administration CLI')
    .showHelpAfterError();

  const catalog = program.command('catalog').description('Manage course catalogs');

  catalog
    .command('validate')
    .description('Validate a manifest and CSV without contacting the API')
    .requiredOption('--manifest <path>', 'manifest JSON path')
    .requiredOption('--csv <path>', 'catalog CSV or CSV.gz path')
    .option('--environment <name>', 'target environment label', 'validation')
    .action(async (options: {
      manifest: string;
      csv: string;
      environment: string;
    }) => {
      const prepared = await prepareFromFiles(dependencies, {
        csvPath: options.csv,
        manifestPath: options.manifest,
        environment: options.environment,
      });
      dependencies.writeLine(
        JSON.stringify(
          {
            valid: true,
            filename: prepared.filename,
            checksum: prepared.parsed.metadata.checksum,
            manifest_hash: prepared.parsed.metadata.manifest_hash,
            row_count: prepared.parsed.metadata.row_count,
            course_count: prepared.parsed.courses.length,
            class_section_count: prepared.parsed.class_sections.length,
            batch_count: prepared.batches.length,
            warnings: prepared.parsed.metadata.warnings,
          },
          null,
          2,
        ),
      );
    });

  catalog
    .command('plan')
    .description('Upload normalized batches and calculate a catalog diff')
    .requiredOption('--manifest <path>', 'manifest JSON path')
    .requiredOption('--csv <path>', 'catalog CSV or CSV.gz path')
    .requiredOption('--api <url>', 'DDL Tracker API base URL')
    .requiredOption('--environment <name>', 'target environment label')
    .option('--state <path>', 'resume state path')
    .option(
      '--token-env <name>',
      'environment variable containing the bearer token',
      'DDL_TRACKER_ADMIN_TOKEN',
    )
    .action(async (options: {
      manifest: string;
      csv: string;
      api: string;
      environment: string;
      state?: string;
      tokenEnv: string;
    }) => {
      const prepared = await prepareFromFiles(dependencies, {
        csvPath: options.csv,
        manifestPath: options.manifest,
        environment: options.environment,
      });
      const statePath = options.state ?? `${options.csv}.ddl-import.json`;
      const state = await readCatalogImportState(statePath);
      if (state !== null) {
        assertResumeMatches(state, prepared);
      }
      const client = dependencies.createClient({
        baseUrl: options.api,
        token: requiredToken(dependencies, options.tokenEnv),
      });

      if (state?.next_plan_batch === prepared.batches.length) {
        dependencies.writeLine(
          JSON.stringify(await client.getStatus(state.import_id), null, 2),
        );
        return;
      }

      const result = await planCatalogImport(client, prepared, {
        ...(state === null
          ? {}
          : {
              importId: state.import_id,
              startBatchIndex: state.next_plan_batch,
            }),
        onProgress: async ({ completed, total, importId }) => {
          await writeCatalogImportState(statePath, {
            schema_version: 1,
            import_id: importId,
            checksum: prepared.parsed.metadata.checksum,
            manifest_hash: prepared.parsed.metadata.manifest_hash,
            environment: prepared.environment,
            total_batches: total,
            next_plan_batch: completed,
          });
          dependencies.writeLine(`plan ${String(completed)}/${String(total)}`);
        },
      });
      dependencies.writeLine(JSON.stringify(result.response, null, 2));
    });

  catalog
    .command('upload')
    .description('Upload one .csv.gz file and create a complete catalog plan')
    .requiredOption('--manifest <path>', 'manifest JSON path')
    .requiredOption('--csv <path>', 'catalog CSV.gz path')
    .requiredOption('--api <url>', 'DDL Tracker API base URL')
    .option(
      '--token-env <name>',
      'environment variable containing the bearer token',
      'DDL_TRACKER_ADMIN_TOKEN',
    )
    .action(async (options: {
      manifest: string;
      csv: string;
      api: string;
      tokenEnv: string;
    }) => {
      if (!/\.csv\.gz$/iu.test(options.csv)) {
        throw new Error('Catalog upload requires a .csv.gz file.');
      }
      const [manifestJson, catalogGzip] = await Promise.all([
        dependencies.readTextFile(options.manifest),
        dependencies.readBinaryFile(options.csv),
      ]);
      if (catalogGzip[0] !== 0x1f || catalogGzip[1] !== 0x8b) {
        throw new Error('Catalog upload file is not gzip data.');
      }
      const client = dependencies.createClient({
        baseUrl: options.api,
        token: requiredToken(dependencies, options.tokenEnv),
      });
      const result = await client.upload({
        filename: basename(options.csv),
        catalogGzip,
        manifestJson,
      });
      dependencies.writeLine(JSON.stringify(result, null, 2));
    });

  catalog
    .command('status')
    .description('Read catalog import progress')
    .requiredOption('--api <url>', 'DDL Tracker API base URL')
    .requiredOption('--import <id>', 'catalog import ID')
    .option(
      '--token-env <name>',
      'environment variable containing the bearer token',
      'DDL_TRACKER_ADMIN_TOKEN',
    )
    .action(async (options: {
      api: string;
      import: string;
      tokenEnv: string;
    }) => {
      const client = dependencies.createClient({
        baseUrl: options.api,
        token: requiredToken(dependencies, options.tokenEnv),
      });
      dependencies.writeLine(
        JSON.stringify(await client.getStatus(options.import), null, 2),
      );
    });

  catalog
    .command('cancel')
    .description('Cancel a planned catalog import and remove its payloads')
    .requiredOption('--api <url>', 'DDL Tracker API base URL')
    .requiredOption('--import <id>', 'catalog import ID')
    .requiredOption('--reason <text>', 'audit reason')
    .option(
      '--token-env <name>',
      'environment variable containing the bearer token',
      'DDL_TRACKER_ADMIN_TOKEN',
    )
    .action(async (options: {
      api: string;
      import: string;
      reason: string;
      tokenEnv: string;
    }) => {
      const confirmation = await dependencies.prompt(
        `Type CANCEL ${options.import} to continue: `,
      );
      if (confirmation !== `CANCEL ${options.import}`) {
        throw new Error('Catalog cancel confirmation did not match.');
      }
      const client = dependencies.createClient({
        baseUrl: options.api,
        token: requiredToken(dependencies, options.tokenEnv),
      });
      dependencies.writeLine(
        JSON.stringify(
          await client.cancel(options.import, { reason: options.reason }),
          null,
          2,
        ),
      );
    });

  catalog
    .command('apply')
    .description('Apply a completed catalog plan in strict batch order')
    .requiredOption('--api <url>', 'DDL Tracker API base URL')
    .requiredOption('--import <id>', 'catalog import ID')
    .option(
      '--token-env <name>',
      'environment variable containing the bearer token',
      'DDL_TRACKER_ADMIN_TOKEN',
    )
    .action(async (options: {
      api: string;
      import: string;
      tokenEnv: string;
    }) => {
      const client = dependencies.createClient({
        baseUrl: options.api,
        token: requiredToken(dependencies, options.tokenEnv),
      });
      const status = await client.getStatus(options.import);
      if (status.diff === null) {
        throw new Error('Catalog import plan is not complete.');
      }
      const confirmation = await dependencies.prompt(
        `Type APPLY ${options.import} to continue: `,
      );
      if (confirmation !== `APPLY ${options.import}`) {
        throw new Error('Catalog apply confirmation did not match.');
      }
      const deactivationCount =
        status.diff.courses.deactivated +
        status.diff.class_sections.deactivated;
      if (deactivationCount > 0) {
        const deactivationConfirmation = await dependencies.prompt(
          `Type DEACTIVATE ${String(deactivationCount)} to confirm deactivations: `,
        );
        if (
          deactivationConfirmation !==
          `DEACTIVATE ${String(deactivationCount)}`
        ) {
          throw new Error('Catalog deactivation confirmation did not match.');
        }
      }
      const result = await applyCatalogImport(client, options.import, {
        confirmDeactivations: deactivationCount > 0,
        onProgress: ({ completed, total }) => {
          dependencies.writeLine(`apply ${String(completed)}/${String(total)}`);
        },
      });
      dependencies.writeLine(JSON.stringify(result, null, 2));
    });

  return program;
}
