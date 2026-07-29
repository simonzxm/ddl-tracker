import { describe, expect, it, vi } from 'vitest';

import {
  parseCreatedHyperdriveId,
  parseHyperdriveList,
  parseWranglerJson,
  setupProductionMigration,
} from '../../../scripts/setup-production-migration.mjs';

const runtimeId = '1'.repeat(32);
const migrationId = '2'.repeat(32);
const serviceId = '019f829b-eda3-7890-a171-4b1683cd89ba';

function wranglerJson(value) {
  return `Wrangler banner\n${JSON.stringify(value, null, 2)}\n`;
}

function runtimeHyperdrive() {
  return {
    id: runtimeId,
    name: 'ddl-tracker-postgres',
    origin: {
      scheme: 'postgresql',
      database: 'ddl_tracker',
      user: 'ddl_tracker_runtime',
      service_id: serviceId,
    },
    caching: { disabled: true },
  };
}

function migrationHyperdrive() {
  return {
    id: migrationId,
    name: 'ddl-tracker-postgres-migration',
    origin: {
      scheme: 'postgresql',
      database: 'ddl_tracker',
      user: 'ddl_tracker_migration',
      service_id: serviceId,
    },
    caching: { disabled: true },
  };
}

function apiConfig() {
  return JSON.stringify({
    hyperdrive: [{ binding: 'HYPERDRIVE', id: runtimeId }],
  });
}

function migrationConfig() {
  return JSON.stringify({
    hyperdrive: [{ binding: 'MIGRATION_DATABASE', id: migrationId }],
    vars: { EXPECTED_ROLE: 'ddl_tracker_migration' },
  });
}

describe('setupProductionMigration', () => {
  it('reuses and verifies an already configured migration Hyperdrive', async () => {
    const readPassword = vi.fn(async () => 'unused');
    const written = [];
    const result = await setupProductionMigration({
      apiProductionConfigPath: '/api.json',
      migrationConfigPath: '/migration.json',
      readText: vi.fn(async (path) =>
        path === '/api.json' ? apiConfig() : migrationConfig(),
      ),
      writeText: vi.fn(async (path, value) => {
        written.push({ path, value });
      }),
      runWrangler: vi.fn(async (args) => {
        const id = args.at(-1);
        return wranglerJson(
          id === runtimeId ? runtimeHyperdrive() : migrationHyperdrive(),
        );
      }),
      readPassword,
      writeLine: vi.fn(),
      environment: {},
    });

    expect(result).toMatchObject({
      hyperdriveId: migrationId,
      database: 'ddl_tracker',
      role: 'ddl_tracker_migration',
      serviceId,
    });
    expect(readPassword).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    expect(written[0].value).toContain(migrationId);
    expect(written[0].value).not.toContain('unused');
  });

  it('creates the migration Hyperdrive from the existing VPC service', async () => {
    const commands = [];
    const readPassword = vi.fn(async () => 'database-password');
    const writeText = vi.fn(async () => undefined);
    const result = await setupProductionMigration({
      apiProductionConfigPath: '/api.json',
      migrationConfigPath: '/missing.json',
      readText: vi.fn(async (path) => {
        if (path === '/api.json') return apiConfig();
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }),
      writeText,
      runWrangler: vi.fn(async (args) => {
        commands.push(args);
        if (args[0] === 'hyperdrive' && args[1] === 'get') {
          return wranglerJson(
            args[2] === runtimeId
              ? runtimeHyperdrive()
              : migrationHyperdrive(),
          );
        }
        if (args[0] === 'hyperdrive' && args[1] === 'list') {
          return hyperdriveTable([
            { id: runtimeId, name: 'ddl-tracker-postgres' },
          ]);
        }
        if (args[0] === 'hyperdrive' && args[1] === 'create') {
          return `Created new Hyperdrive PostgreSQL config: ${migrationId}`;
        }
        throw new Error(`Unexpected Wrangler command: ${args.join(' ')}`);
      }),
      readPassword,
      writeLine: vi.fn(),
      environment: {},
    });

    expect(result.hyperdriveId).toBe(migrationId);
    expect(readPassword).toHaveBeenCalledOnce();
    expect(commands).toContainEqual(
      expect.arrayContaining([
        'create',
        'ddl-tracker-postgres-migration',
        '--service-id',
        serviceId,
        '--origin-user',
        'ddl_tracker_migration',
        '--origin-password',
        'database-password',
      ]),
    );
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][1]).not.toContain('database-password');
  });
});

describe('Wrangler output parsing', () => {
  it('reads the JSON object after the Wrangler banner', () => {
    expect(parseWranglerJson(wranglerJson(migrationHyperdrive()))).toEqual(
      migrationHyperdrive(),
    );
  });

  it('reads Hyperdrive IDs and names from the table', () => {
    expect(
      parseHyperdriveList(
        hyperdriveTable([
          { id: runtimeId, name: 'ddl-tracker-postgres' },
          { id: migrationId, name: 'ddl-tracker-postgres-migration' },
        ]),
      ),
    ).toEqual([
      { id: runtimeId, name: 'ddl-tracker-postgres' },
      { id: migrationId, name: 'ddl-tracker-postgres-migration' },
    ]);
  });

  it('reads the ID returned by Hyperdrive creation', () => {
    expect(
      parseCreatedHyperdriveId(
        `Created new Hyperdrive PostgreSQL config: ${migrationId}`,
      ),
    ).toBe(migrationId);
  });
});

function hyperdriveTable(entries) {
  return [
    '┌──────────────────────────────────┬────────────────────────────────┐',
    '│ id                               │ name                           │',
    '├──────────────────────────────────┼────────────────────────────────┤',
    ...entries.map(
      ({ id, name }) => `│ ${id} │ ${name.padEnd(30)} │`,
    ),
    '└──────────────────────────────────┴────────────────────────────────┘',
  ].join('\n');
}
