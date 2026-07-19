import { createUuidV7 } from '@ddl-tracker/contracts';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { HttpError, toApiError } from './errors.js';

interface AppVariables {
  requestId: string;
}

export interface AppDependencies {
  createRequestId?: () => string;
  checkReady: () => Promise<boolean>;
}

export function createApp(dependencies: AppDependencies): Hono<{
  Variables: AppVariables;
}> {
  const app = new Hono<{ Variables: AppVariables }>();
  const createRequestId = dependencies.createRequestId ?? createUuidV7;

  app.use('*', async (context, next) => {
    const incoming = context.req.header('x-request-id');
    const requestId =
      incoming !== undefined &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        incoming,
      )
        ? incoming
        : createRequestId();
    context.set('requestId', requestId);
    await next();
    context.header('x-request-id', requestId);
  });

  app.get('/health/live', (context) => context.json({ status: 'live' }));

  app.get('/health/ready', async (context) => {
    const ready = await dependencies.checkReady().catch(() => false);

    if (!ready) {
      throw new HttpError({
        code: 'temporarily_unavailable',
        message: 'Service is not ready.',
        retryable: true,
        status: 503,
      });
    }

    return context.json({ status: 'ready' });
  });

  app.notFound((context) => {
    const requestId = context.get('requestId');
    return context.json(
      toApiError(
        new HttpError({
          code: 'not_found',
          message: 'Route not found.',
          status: 404,
        }),
        requestId,
      ),
      404,
    );
  });

  app.onError((error, context) => {
    const requestId = context.get('requestId');
    const httpError =
      error instanceof HttpError
        ? error
        : new HttpError({
            code: 'internal_error',
            message: 'An internal error occurred.',
            retryable: true,
            status: 500,
          });
    const status = httpError.status as ContentfulStatusCode;
    if (httpError.retryAfter !== undefined) {
      context.header('retry-after', String(httpError.retryAfter));
    }
    context.header('x-request-id', requestId);
    return context.json(toApiError(httpError, requestId), status);
  });

  return app;
}
