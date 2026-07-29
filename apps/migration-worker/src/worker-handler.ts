import type { Client } from 'pg';

import {
  MigrationError,
  runMigrations,
  type MigrationDatabase,
  type MigrationDefinition,
  type MigrationRunResult,
} from './migrate.js';

export interface MigrationWorkerEnvironment {
  readonly MIGRATION_DATABASE: {
    readonly connectionString: string;
  };
  readonly MIGRATION_TOKEN: string;
  readonly EXPECTED_DATABASE: string;
  readonly EXPECTED_ROLE: string;
}

export interface MigrationWorker {
  fetch(
    request: Request,
    environment: MigrationWorkerEnvironment,
  ): Promise<Response>;
}

export interface MigrationWorkerOptions {
  readonly createClient: (connectionString: string) => Client;
  readonly migrations: readonly MigrationDefinition[];
  readonly executeMigrations?: typeof runMigrations;
}

interface FailureResponse {
  readonly status: 'failed';
  readonly code:
    | 'database_identity_mismatch'
    | 'database_unavailable'
    | 'migration_bundle_invalid'
    | 'migration_execution_failed'
    | 'migration_history_mismatch';
  readonly message: string;
  readonly requestId: string;
}

export function createMigrationWorker(
  options: MigrationWorkerOptions,
): MigrationWorker {
  const executeMigrations = options.executeMigrations ?? runMigrations;

  return {
    async fetch(request, environment): Promise<Response> {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/migrate') {
        return notFound();
      }
      if (!(await isAuthorized(request, environment.MIGRATION_TOKEN))) {
        return notFound();
      }

      const requestId = crypto.randomUUID();
      let client: Client | undefined;
      let connected = false;
      try {
        client = options.createClient(
          environment.MIGRATION_DATABASE.connectionString,
        );
        await client.connect();
        connected = true;
        const result = await executeMigrations({
          database: databaseAdapter(client),
          migrations: options.migrations,
          expectedDatabase: environment.EXPECTED_DATABASE,
          expectedRole: environment.EXPECTED_ROLE,
        });
        logResult(requestId, result);
        return Response.json(result, {
          headers: { 'cache-control': 'no-store' },
        });
      } catch (error) {
        const failure = failureResponse(error, connected, requestId);
        console.error(
          JSON.stringify({
            type: 'database_migration',
            request_id: requestId,
            status: 'failed',
            code: failure.body.code,
          }),
        );
        return Response.json(failure.body, {
          status: failure.httpStatus,
          headers: { 'cache-control': 'no-store' },
        });
      } finally {
        if (client !== undefined) {
          try {
            await client.end();
          } catch {
            console.error(
              JSON.stringify({
                type: 'database_migration',
                request_id: requestId,
                status: 'client_close_failed',
              }),
            );
          }
        }
      }
    },
  };
}

function databaseAdapter(client: Client): MigrationDatabase {
  return {
    async query(text, values) {
      const result =
        values === undefined
          ? await client.query(text)
          : await client.query(text, [...values]);
      return {
        rows: result.rows as readonly Record<string, unknown>[],
      };
    },
  };
}

async function isAuthorized(
  request: Request,
  expectedToken: string,
): Promise<boolean> {
  if (expectedToken.length < 32) return false;
  const authorization = request.headers.get('authorization') ?? '';
  const suppliedToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const encoder = new TextEncoder();
  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(suppliedToken)),
    crypto.subtle.digest('SHA-256', encoder.encode(expectedToken)),
  ]);
  const supplied = new Uint8Array(suppliedDigest);
  const expected = new Uint8Array(expectedDigest);
  let difference = 0;
  for (const [index, value] of supplied.entries()) {
    difference |= value ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

function failureResponse(
  error: unknown,
  connected: boolean,
  requestId: string,
): { httpStatus: number; body: FailureResponse } {
  if (!connected) {
    return {
      httpStatus: 503,
      body: {
        status: 'failed',
        code: 'database_unavailable',
        message: 'The migration database is unavailable.',
        requestId,
      },
    };
  }
  if (error instanceof MigrationError) {
    const httpStatus =
      error.code === 'migration_execution_failed' ? 500 : 409;
    return {
      httpStatus,
      body: {
        status: 'failed',
        code: error.code,
        message: error.message,
        requestId,
      },
    };
  }
  return {
    httpStatus: 500,
    body: {
      status: 'failed',
      code: 'migration_execution_failed',
      message: 'The migration failed.',
      requestId,
    },
  };
}

function notFound(): Response {
  return new Response('Not found.', {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
}

function logResult(requestId: string, result: MigrationRunResult): void {
  console.log(
    JSON.stringify({
      type: 'database_migration',
      request_id: requestId,
      status: result.status,
      previous_migration: result.previousMigration,
      applied: result.applied,
      latest_migration: result.latestMigration,
    }),
  );
}
