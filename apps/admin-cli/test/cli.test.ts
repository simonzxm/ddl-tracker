import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProgram, type CliDependencies } from '../src/cli.js';
import type { CatalogWorkflowClient } from '../src/catalog/workflow.js';

const IMPORT_ID = '018f0000-0000-7000-8000-000000001301';
const directories: string[] = [];
const headers = [
  'XNXQDM', 'XNXQDM_DISPLAY', 'KCH', 'KCM', 'XF', 'PKDWDM',
  'PKDWDM_DISPLAY', 'JXBID', 'JXBMC', 'KXH', 'SKJS', 'XXXQDM',
  'XXXQDM_DISPLAY', 'XKZRS', 'YPSJDD', 'SKZC', 'SKXQ', 'SKJC',
  'SKJAS', 'JXLDM', 'JXLDM_DISPLAY',
];
const row = [
  '2026-2027-1', 'Term', '0010', 'Course', '3.00', '001',
  'Department', 'section-1', 'Section', '01', '', '', '', '', '', '',
  '', '', '', '', '',
];
const manifest = JSON.stringify({
  schema_version: 1,
  source_system: 'test',
  term: {
    external_code: '2026-2027-1',
    display_name: 'Term',
    starts_on: '2026-08-31',
    ends_on: '2027-01-17',
    time_zone: 'Asia/Shanghai',
  },
});
const csv = new TextEncoder().encode(`${headers.join(',')}\n${row.join(',')}\n`);

function apiClient(deactivations = 0): CatalogWorkflowClient & {
  planBatch: ReturnType<typeof vi.fn>;
  applyAll: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
} {
  const diff = {
    terms: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
    courses: { added: 1, updated: 0, unchanged: 0, deactivated: 0 },
    class_sections: {
      added: 1,
      updated: 0,
      unchanged: 0,
      deactivated: deactivations,
    },
    field_changes: {},
    deactivated_class_section_ids: [],
    checksum_previously_applied: false,
  };
  return {
    planBatch: vi.fn(async (request) => ({
      import_id: IMPORT_ID,
      batch_index: request.batch_index,
      accepted: true,
      received_batches: 1,
      total_batches: 1,
      plan_complete: true,
      diff,
    })),
    applyAll: vi.fn(async () => ({
      import_id: IMPORT_ID,
      batch_index: 0,
      replayed: false,
      applied_batches: 1,
      total_batches: 1,
      complete: true,
    })),
    getStatus: vi.fn(async () => ({
      import_id: IMPORT_ID,
      status: 'planned' as const,
      received_batches: 1,
      applied_batches: 0,
      total_batches: 1,
      diff,
      failure_message: null,
    })),
  };
}

async function testDependencies(options?: {
  client?: ReturnType<typeof apiClient>;
  prompts?: string[];
  csvBytes?: Uint8Array;
}) {
  const output: string[] = [];
  const client = options?.client ?? apiClient();
  const prompts = [...(options?.prompts ?? [])];
  const dependencies: Partial<CliDependencies> = {
    env: { ...process.env, DDL_TRACKER_ADMIN_TOKEN: 'secret-token' },
    readTextFile: vi.fn(async () => manifest),
    readBinaryFile: vi.fn(async () => options?.csvBytes ?? csv),
    writeLine: (value) => output.push(value),
    prompt: vi.fn(async () => prompts.shift() ?? ''),
    createClient: vi.fn(() => client),
  };
  return { dependencies, output, client };
}

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ddl-tracker-cli-'));
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

describe('admin CLI', () => {
  it('validates files without constructing an API client', async () => {
    const { dependencies, output } = await testDependencies();
    const createClient = dependencies.createClient as ReturnType<typeof vi.fn>;
    const program = createProgram(dependencies).exitOverride();

    await program.parseAsync(
      ['catalog', 'validate', '--manifest', 'manifest.json', '--csv', 'data.csv'],
      { from: 'user' },
    );

    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      valid: true,
      row_count: 1,
      batch_count: 1,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('validates gzip-compressed CSV input', async () => {
    const { dependencies, output } = await testDependencies({
      csvBytes: gzipSync(csv),
    });
    const program = createProgram(dependencies).exitOverride();

    await program.parseAsync(
      [
        'catalog',
        'validate',
        '--manifest',
        'manifest.json',
        '--csv',
        'data.csv.gz',
      ],
      { from: 'user' },
    );

    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      valid: true,
      row_count: 1,
    });
  });

  it('plans with an environment token and persists credential-free resume state', async () => {
    const statePath = await temporaryStatePath();
    const { dependencies, client } = await testDependencies();
    const program = createProgram(dependencies).exitOverride();

    await program.parseAsync(
      [
        'catalog', 'plan', '--manifest', 'manifest.json', '--csv', 'data.csv',
        '--api', 'https://api.example.test', '--environment', 'staging',
        '--state', statePath,
      ],
      { from: 'user' },
    );

    expect(client.planBatch).toHaveBeenCalledOnce();
    const stateText = await readFile(statePath, 'utf8');
    expect(JSON.parse(stateText)).toMatchObject({
      import_id: IMPORT_ID,
      environment: 'staging',
      next_plan_batch: 1,
    });
    expect(stateText).not.toContain('secret-token');
  });

  it('requires exact apply and deactivation confirmations', async () => {
    const client = apiClient(1);
    const { dependencies } = await testDependencies({
      client,
      prompts: [`APPLY ${IMPORT_ID}`, 'DEACTIVATE 1'],
    });
    const program = createProgram(dependencies).exitOverride();

    await program.parseAsync(
      ['catalog', 'apply', '--api', 'https://api.example.test', '--import', IMPORT_ID],
      { from: 'user' },
    );

    expect(client.applyAll).toHaveBeenCalledWith(IMPORT_ID, {
      confirm_deactivations: true,
    });
  });

  it('does not apply after a mismatched confirmation', async () => {
    const client = apiClient(1);
    const { dependencies } = await testDependencies({ client, prompts: ['no'] });
    const program = createProgram(dependencies).exitOverride();

    await expect(
      program.parseAsync(
        ['catalog', 'apply', '--api', 'https://api.example.test', '--import', IMPORT_ID],
        { from: 'user' },
      ),
    ).rejects.toThrow('confirmation did not match');
    expect(client.applyAll).not.toHaveBeenCalled();
  });
});
