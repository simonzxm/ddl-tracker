import type { Client } from 'pg';

import { createUuidV7 } from '@ddl-tracker/contracts';

import type { MailDelivery } from './auth/email-challenge-service.js';
import type { SmtpSession } from './auth/smtp-mail-delivery.js';
import { createApp, type RequestLogEntry } from './http/app.js';
import { HttpError, toApiError } from './http/errors.js';
import { PostgresRetentionService } from './maintenance/postgres-retention-service.js';
import { createRuntimeApp } from './runtime-app.js';

export interface RetentionRunner {
  runBatch(input: { now: Date; limit: number }): Promise<unknown>;
}

export interface WorkerHandlerOptions {
  createClient(connectionString: string): Client;
  createRetentionRunner?: (client: Client) => RetentionRunner;
  mailDelivery?: MailDelivery;
  createSmtpSession?: () => SmtpSession;
  logRequest?: (entry: RequestLogEntry) => void;
}

export interface WorkerFetchHandler {
  fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response>;
  scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void>;
}

export function createWorkerHandler(
  options: WorkerHandlerOptions,
): WorkerFetchHandler {
  return {
    async fetch(request, env, context): Promise<Response> {
      if (new URL(request.url).pathname === '/api/health/live') {
        return createApp({
          checkReady: () => Promise.resolve(false),
          ...(options.logRequest === undefined
            ? {}
            : { logRequest: options.logRequest }),
        }).fetch(request, env, context);
      }

      const client = options.createClient(env.HYPERDRIVE.connectionString);
      let connected = false;
      try {
        try {
          await client.connect();
        } catch {
          return databaseUnavailableResponse(request, options.logRequest);
        }
        connected = true;
        return await createRuntimeApp(client, env, {
          ...(options.mailDelivery === undefined
            ? {}
            : { mailDelivery: options.mailDelivery }),
          ...(options.createSmtpSession === undefined
            ? {}
            : { createSmtpSession: options.createSmtpSession }),
          ...(options.logRequest === undefined
            ? {}
            : { logRequest: options.logRequest }),
        }).fetch(request, env, context);
      } finally {
        if (connected) await client.end();
      }
    },

    async scheduled(controller, env): Promise<void> {
      const client = options.createClient(env.HYPERDRIVE.connectionString);
      let connected = false;
      try {
        await client.connect();
        connected = true;
        const retention =
          options.createRetentionRunner?.(client) ??
          new PostgresRetentionService(client, { createId: createUuidV7 });
        await retention.runBatch({
          now: new Date(controller.scheduledTime),
          limit: 1000,
        });
      } finally {
        if (connected) await client.end();
      }
    },
  };
}

function databaseUnavailableResponse(
  request: Request,
  logRequest: ((entry: RequestLogEntry) => void) | undefined,
): Response {
  const requestId = createUuidV7();
  const error = new HttpError({
    code: 'temporarily_unavailable',
    message: 'Service is temporarily unavailable.',
    retryAfter: 1,
    retryable: true,
    status: 503,
  });
  const response = Response.json(toApiError(error, requestId), {
    status: 503,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'X-Request-ID,Retry-After',
      'retry-after': '1',
      'x-request-id': requestId,
    },
  });
  try {
    logRequest?.({
      request_id: requestId,
      method: request.method,
      route: new URL(request.url).pathname,
      status: 503,
      duration_ms: 0,
    });
  } catch {
    // Logging failures must never change an API response.
  }
  return response;
}
