import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runCommand } from './run-command.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiProductionConfigPath = resolve(
  root,
  'apps/api/wrangler.production.jsonc',
);
export const productionMigrationConfigPath = resolve(
  root,
  'apps/migration-worker/wrangler.production.jsonc',
);

const defaultMigrationHyperdriveName = 'ddl-tracker-postgres-migration';
const defaultMigrationRole = 'ddl_tracker_migration';

export async function setupProductionMigration(options = {}) {
  const environment = options.environment ?? process.env;
  const runWrangler = options.runWrangler ?? defaultRunWrangler;
  const readPassword = options.readPassword ?? readHiddenLine;
  const writeLine =
    options.writeLine ?? ((value) => globalThis.console.log(value));
  const readText = options.readText ?? ((path) => readFile(path, 'utf8'));
  const writeText =
    options.writeText ??
    (async (path, value) => {
      await writeFile(path, value, { encoding: 'utf8', mode: 0o600 });
      await chmod(path, 0o600);
    });
  const migrationConfigPath =
    options.migrationConfigPath ?? productionMigrationConfigPath;
  const apiConfigPath =
    options.apiProductionConfigPath ?? apiProductionConfigPath;

  const apiConfig = parseJson(
    await readText(apiConfigPath),
    'API production Wrangler config',
  );
  const runtimeHyperdriveId = readBindingId(apiConfig, 'HYPERDRIVE');
  const runtimeHyperdrive = parseWranglerJson(
    await runWrangler(['hyperdrive', 'get', runtimeHyperdriveId]),
  );
  const serviceId = readString(
    runtimeHyperdrive.origin?.service_id,
    'runtime Hyperdrive VPC service ID',
  );
  const database = readString(
    runtimeHyperdrive.origin?.database,
    'runtime Hyperdrive database',
  );

  const localConfigText = await readOptionalText(readText, migrationConfigPath);
  const localConfig =
    localConfigText === null
      ? null
      : parseJson(localConfigText, 'migration Worker production config');
  const configuredRole = localConfig?.vars?.EXPECTED_ROLE;
  const migrationRole =
    environment.DDL_TRACKER_MIGRATION_ROLE ??
    (typeof configuredRole === 'string'
      ? configuredRole
      : defaultMigrationRole);
  const hyperdriveName =
    environment.DDL_TRACKER_MIGRATION_HYPERDRIVE_NAME ??
    defaultMigrationHyperdriveName;

  let migrationHyperdrive;
  if (localConfig !== null) {
    const configuredId = readBindingId(
      localConfig,
      'MIGRATION_DATABASE',
    );
    migrationHyperdrive = parseWranglerJson(
      await runWrangler(['hyperdrive', 'get', configuredId]),
    );
  } else {
    const listed = parseHyperdriveList(
      await runWrangler(['hyperdrive', 'list']),
    ).filter(({ name }) => name === hyperdriveName);
    if (listed.length > 1) {
      throw new Error(
        `Multiple Hyperdrive configs are named ${hyperdriveName}; remove duplicates before continuing.`,
      );
    }

    if (listed.length === 1) {
      migrationHyperdrive = parseWranglerJson(
        await runWrangler(['hyperdrive', 'get', listed[0].id]),
      );
    } else {
      const password =
        environment.DDL_TRACKER_MIGRATION_DATABASE_PASSWORD ??
        (await readPassword('Production migration database password: '));
      if (password.length === 0) {
        throw new Error('The production migration database password is empty.');
      }
      writeLine('Creating the migration-role Hyperdrive config...');
      const createOutput = await runWrangler(
        [
          'hyperdrive',
          'create',
          hyperdriveName,
          '--service-id',
          serviceId,
          '--origin-scheme',
          'postgresql',
          '--database',
          database,
          '--origin-user',
          migrationRole,
          '--origin-password',
          password,
          '--caching-disabled',
          '--origin-connection-limit',
          '2',
        ],
        { redact: [password] },
      );
      const createdId = parseCreatedHyperdriveId(createOutput);
      migrationHyperdrive = parseWranglerJson(
        await runWrangler(['hyperdrive', 'get', createdId]),
      );
    }
  }

  verifyMigrationHyperdrive(migrationHyperdrive, {
    serviceId,
    database,
    role: migrationRole,
  });
  const migrationHyperdriveId = readString(
    migrationHyperdrive.id,
    'migration Hyperdrive ID',
  );
  await writeText(
    migrationConfigPath,
    renderMigrationWorkerConfig({
      hyperdriveId: migrationHyperdriveId,
      database,
      role: migrationRole,
    }),
  );
  writeLine(`Migration Hyperdrive verified: ${migrationHyperdriveId}`);
  return {
    configPath: migrationConfigPath,
    hyperdriveId: migrationHyperdriveId,
    database,
    role: migrationRole,
    serviceId,
  };
}

export function parseWranglerJson(output) {
  const lines = output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === '{');
  let end = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() === '}') {
      end = index;
      break;
    }
  }
  if (start === -1 || end < start) {
    throw new Error('Wrangler did not return a JSON Hyperdrive config.');
  }
  return parseJson(lines.slice(start, end + 1).join('\n'), 'Wrangler output');
}

export function parseHyperdriveList(output) {
  const entries = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line.includes('│')) continue;
    const cells = line
      .split('│')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const id = cells[0];
    const name = cells[1];
    if (
      typeof id === 'string' &&
      /^[0-9a-f]{32}$/u.test(id) &&
      typeof name === 'string' &&
      name.length > 0
    ) {
      entries.push({ id, name });
    }
  }
  return entries;
}

export function parseCreatedHyperdriveId(output) {
  const match = output.match(
    /Created new Hyperdrive [^\n]* config:\s*([0-9a-f]{32})\b/iu,
  );
  if (match?.[1] === undefined) {
    throw new Error(
      'The migration Hyperdrive was created, but Wrangler did not return its ID.',
    );
  }
  return match[1];
}

export function renderMigrationWorkerConfig({
  hyperdriveId,
  database,
  role,
}) {
  return `${JSON.stringify(
    {
      $schema: '../../node_modules/wrangler/config-schema.json',
      name: 'ddl-tracker-migration-worker',
      main: 'src/index.ts',
      compatibility_date: '2026-07-29',
      compatibility_flags: ['nodejs_compat'],
      workers_dev: true,
      observability: { enabled: true, logs: { enabled: true } },
      hyperdrive: [
        { binding: 'MIGRATION_DATABASE', id: hyperdriveId },
      ],
      vars: { EXPECTED_DATABASE: database, EXPECTED_ROLE: role },
      secrets: { required: ['MIGRATION_TOKEN'] },
    },
    null,
    2,
  )}\n`;
}

async function readOptionalText(readText, path) {
  try {
    return await readText(path);
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
}

function readBindingId(config, binding) {
  if (!Array.isArray(config.hyperdrive)) {
    throw new Error(`Wrangler config has no ${binding} Hyperdrive binding.`);
  }
  const matches = config.hyperdrive.filter(
    (entry) => entry?.binding === binding,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Wrangler config must contain exactly one ${binding} Hyperdrive binding.`,
    );
  }
  const id = matches[0].id;
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/u.test(id)) {
    throw new Error(`${binding} Hyperdrive ID is invalid.`);
  }
  return id;
}

function verifyMigrationHyperdrive(config, expected) {
  const id = readString(config.id, 'migration Hyperdrive ID');
  const serviceId = readString(
    config.origin?.service_id,
    'migration Hyperdrive VPC service ID',
  );
  const database = readString(
    config.origin?.database,
    'migration Hyperdrive database',
  );
  const role = readString(config.origin?.user, 'migration Hyperdrive role');
  if (
    serviceId !== expected.serviceId ||
    database !== expected.database ||
    role !== expected.role ||
    config.caching?.disabled !== true
  ) {
    throw new Error(
      `Migration Hyperdrive ${id} does not match the required VPC service, database, role, or cache policy.`,
    );
  }
}

function readString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is missing.`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    const value = JSON.parse(text);
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('not an object');
    }
    return value;
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

function defaultRunWrangler(args, options = {}) {
  const result = runCommand('pnpm', ['exec', 'wrangler', ...args], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
    redact: options.redact,
    failureMessage: 'Wrangler failed while configuring Hyperdrive.',
  });
  return `${result.stdout}${result.stderr}`;
}

async function readHiddenLine(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Set DDL_TRACKER_MIGRATION_DATABASE_PASSWORD for non-interactive setup.',
    );
  }
  process.stdout.write(prompt);
  return await new Promise((resolvePromise, rejectPromise) => {
    const input = process.stdin;
    const previousRawMode = input.isRaw;
    let value = '';

    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(previousRawMode);
      input.pause();
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolvePromise(value);
          return;
        }
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          rejectPromise(new Error('Migration setup was cancelled.'));
          return;
        }
        if (character === '\u007f') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };

    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  try {
    await setupProductionMigration();
  } catch (error) {
    globalThis.console.error(
      error instanceof Error ? error.message : 'Migration setup failed.',
    );
    process.exitCode = 1;
  }
}
