import {
  apiErrorSchema,
  createUuidV7,
  healthResponseSchema,
} from '@ddl-tracker/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  registerAdminCatalogRoutes,
  type AdminCatalogRouteDependencies,
} from './admin-catalog-routes.js';
import { registerAdminRoutes, type AdminRouteDependencies } from './admin-routes.js';
import { registerAuthRoutes, type AuthRouteDependencies } from './auth-routes.js';
import {
  registerCatalogRoutes,
  type CatalogRouteDependencies,
} from './catalog-routes.js';
import {
  registerCommentHistoryRoutes,
  type CommentHistoryRouteDependencies,
} from './comment-history-routes.js';
import { openApiDocument } from '../openapi.js';
import { HttpError, toApiError } from './errors.js';
import { registerSyncRoutes, type SyncRouteDependencies } from './sync-routes.js';

export interface AppVariables {
  requestId: string;
}

export interface RequestLogEntry {
  request_id: string;
  method: string;
  route: string;
  status: number;
  duration_ms: number;
}

export interface AppDependencies {
  createRequestId?: () => string;
  nowMilliseconds?: () => number;
  logRequest?: (entry: RequestLogEntry) => void;
  checkReady: () => Promise<boolean>;
  auth?: AuthRouteDependencies;
  catalog?: CatalogRouteDependencies;
  adminCatalog?: AdminCatalogRouteDependencies;
  admin?: AdminRouteDependencies;
  comments?: CommentHistoryRouteDependencies;
  sync?: SyncRouteDependencies;
}

export function createApp(dependencies: AppDependencies): Hono<{
  Variables: AppVariables;
}> {
  const app = new Hono<{ Variables: AppVariables }>().basePath('/api');
  const createRequestId = dependencies.createRequestId ?? createUuidV7;
  const nowMilliseconds =
    dependencies.nowMilliseconds ?? (() => globalThis.performance.now());

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

  if (dependencies.logRequest !== undefined) {
    app.use('*', async (context, next) => {
      const startedAt = nowMilliseconds();
      await next();
      const entry: RequestLogEntry = {
        request_id: context.get('requestId'),
        method: context.req.method,
        // Hono's helper intentionally accepts an any-parameterized Context.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        route: routePath(context, -1),
        status: context.res.status,
        duration_ms: Math.max(0, Math.round(nowMilliseconds() - startedAt)),
      };
      try {
        dependencies.logRequest?.(entry);
      } catch {
        // Logging failures must never change an API response.
      }
    });
  }

  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
      allowMethods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['X-Request-ID', 'Retry-After'],
      maxAge: 86_400,
    }),
  );

  app.get('/health/live', (context) =>
    context.json(healthResponseSchema.parse({ status: 'live' })),
  );
  app.get('/openapi.json', (context) => context.json(openApiDocument));

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

    return context.json(healthResponseSchema.parse({ status: 'ready' }));
  });

  if (dependencies.auth !== undefined) {
    registerAuthRoutes(app, dependencies.auth);
  }
  if (dependencies.catalog !== undefined) {
    registerCatalogRoutes(app, dependencies.catalog);
  }
  if (dependencies.adminCatalog !== undefined) {
    registerAdminCatalogRoutes(app, dependencies.adminCatalog);
  }
  if (dependencies.admin !== undefined) {
    registerAdminRoutes(app, dependencies.admin);
  }
  if (dependencies.comments !== undefined) {
    registerCommentHistoryRoutes(app, dependencies.comments);
  }

  if (dependencies.sync !== undefined) {
    registerSyncRoutes(app, dependencies.sync);
  }

  app.notFound((context) => {
    const requestId = context.get('requestId') ?? createRequestId();
    context.header('x-request-id', requestId);
    return context.json(
      apiErrorSchema.parse(
        toApiError(
          new HttpError({
            code: 'not_found',
            message: 'Route not found.',
            status: 404,
          }),
          requestId,
        ),
      ),
      404,
    );
  });

  app.onError((error, context) => {
    const requestId = context.get('requestId') ?? createRequestId();
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
    return context.json(
      apiErrorSchema.parse(toApiError(httpError, requestId)),
      status,
    );
  });

  return app;
}
