import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { Command } from 'commander';

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

export interface CliDependencies {
  env: NodeJS.ProcessEnv;
  readTextFile(path: string): Promise<string>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeLine(value: string): void;
  prompt(value: string): Promise<string>;
  createClient(options: {
    baseUrl: string;
    token: string;
  }): CatalogWorkflowClient;
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
  const [manifestText, csvBytes] = await Promise.all([
    dependencies.readTextFile(options.manifestPath),
    dependencies.readBinaryFile(options.csvPath),
  ]);
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
    .requiredOption('--csv <path>', 'catalog CSV path')
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
    .requiredOption('--csv <path>', 'catalog CSV path')
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
