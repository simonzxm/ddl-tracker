import type { Client } from 'pg';

import type { MailDelivery } from './auth/email-challenge-service.js';
import type { SmtpSession } from './auth/smtp-mail-delivery.js';
import { createRuntimeApp } from './runtime-app.js';

export interface WorkerHandlerOptions {
  createClient(connectionString: string): Client;
  mailDelivery?: MailDelivery;
  createSmtpSession?: () => SmtpSession;
}

export interface WorkerFetchHandler {
  fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response>;
}

export function createWorkerHandler(
  options: WorkerHandlerOptions,
): WorkerFetchHandler {
  return {
    async fetch(request, env, context): Promise<Response> {
      if (new URL(request.url).pathname === '/health/live') {
        return Response.json({ status: 'live' });
      }

      const client = options.createClient(env.HYPERDRIVE.connectionString);
      let connected = false;
      try {
        await client.connect();
        connected = true;
        return await createRuntimeApp(client, env, {
          ...(options.mailDelivery === undefined
            ? {}
            : { mailDelivery: options.mailDelivery }),
          ...(options.createSmtpSession === undefined
            ? {}
            : { createSmtpSession: options.createSmtpSession }),
        }).fetch(request, env, context);
      } finally {
        if (connected) await client.end();
      }
    },
  };
}
