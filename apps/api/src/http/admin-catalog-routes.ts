import {
  catalogApplyAllRequestSchema,
  catalogApplyResponseSchema,
  catalogCancelRequestSchema,
  catalogCancelResponseSchema,
  catalogImportStatusSchema,
  catalogPlanBatchRequestSchema,
  catalogPlanBatchResponseSchema,
  catalogUploadResponseSchema,
  parseUuidV7,
  type CatalogApplyAllRequest,
  type CatalogApplyResponse,
  type CatalogCancelRequest,
  type CatalogCancelResponse,
  type CatalogImportStatus,
  type CatalogPlanBatchRequest,
  type CatalogPlanBatchResponse,
  type CatalogUploadResponse,
} from '@ddl-tracker/contracts';
import type { CatalogUploadSource } from '@ddl-tracker/catalog-import';
import type { Hono } from 'hono';

import type { AuthenticatedPrincipal } from '../auth/account-service.js';
import type { AppVariables } from './app.js';
import { authenticateBearer } from './bearer.js';
import { readCatalogUpload } from './catalog-upload-body.js';
import { HttpError } from './errors.js';
import { readValidatedJson } from './json-body.js';

const ADMIN_BODY_LIMIT = 512 * 1024;

export interface AdminCatalogRouteDependencies {
  environment: string;
  authenticate(token: string): Promise<AuthenticatedPrincipal>;
  rateLimitRead(userId: string): Promise<void>;
  rateLimitMutation(userId: string): Promise<void>;
  planBatch(
    actorId: string,
    request: CatalogPlanBatchRequest,
  ): Promise<CatalogPlanBatchResponse>;
  upload(
    actorId: string,
    requestId: string,
    input: CatalogUploadSource,
  ): Promise<CatalogUploadResponse>;
  applyAll(
    actorId: string,
    importId: string,
    requestId: string,
    request: CatalogApplyAllRequest,
  ): Promise<CatalogApplyResponse>;
  cancel(
    actorId: string,
    importId: string,
    requestId: string,
    request: CatalogCancelRequest,
  ): Promise<CatalogCancelResponse>;
  getStatus(importId: string): Promise<CatalogImportStatus>;
}

async function requireMaintainer(
  authorization: string | undefined,
  dependencies: AdminCatalogRouteDependencies,
  kind: 'read' | 'mutation',
): Promise<AuthenticatedPrincipal> {
  const principal = await authenticateBearer(authorization, (token) =>
    dependencies.authenticate(token),
  );
  if (!principal.roles.includes('maintainer')) {
    throw new HttpError({
      code: 'forbidden',
      message: 'Maintainer role is required.',
      status: 403,
    });
  }
  if (kind === 'read') {
    await dependencies.rateLimitRead(principal.user.id);
  } else {
    await dependencies.rateLimitMutation(principal.user.id);
  }
  return principal;
}

function parseImportId(value: string): string {
  try {
    return parseUuidV7(value);
  } catch {
    throw new HttpError({
      code: 'invalid_request',
      message: 'Import ID is invalid.',
      status: 400,
    });
  }
}

export function registerAdminCatalogRoutes(
  app: Hono<{ Variables: AppVariables }>,
  dependencies: AdminCatalogRouteDependencies,
): void {
  app.post('/v1/admin/catalog/imports/plan', async (context) => {
    const principal = await requireMaintainer(
      context.req.header('authorization'),
      dependencies,
      'mutation',
    );
    const body = await readValidatedJson(
      context.req.raw,
      catalogPlanBatchRequestSchema,
      ADMIN_BODY_LIMIT,
    );
    if (body.environment !== dependencies.environment) {
      throw new HttpError({
        code: 'conflict',
        message: 'Catalog import environment does not match this service.',
        status: 409,
      });
    }
    return context.json(
      catalogPlanBatchResponseSchema.parse(
        await dependencies.planBatch(principal.user.id, body),
      ),
    );
  });

  app.post('/v1/admin/catalog/imports/upload', async (context) => {
    const principal = await requireMaintainer(
      context.req.header('authorization'),
      dependencies,
      'mutation',
    );
    const body = await readCatalogUpload(context.req.raw);
    return context.json(
      catalogUploadResponseSchema.parse(
        await dependencies.upload(
          principal.user.id,
          context.get('requestId'),
          body,
        ),
      ),
    );
  });

  app.post('/v1/admin/catalog/imports/:import_id/apply-all', async (context) => {
    const principal = await requireMaintainer(
      context.req.header('authorization'),
      dependencies,
      'mutation',
    );
    const importId = parseImportId(context.req.param('import_id'));
    const body = await readValidatedJson(
      context.req.raw,
      catalogApplyAllRequestSchema,
      ADMIN_BODY_LIMIT,
    );
    return context.json(
      catalogApplyResponseSchema.parse(
        await dependencies.applyAll(
          principal.user.id,
          importId,
          context.get('requestId'),
          body,
        ),
      ),
    );
  });

  app.post('/v1/admin/catalog/imports/:import_id/cancel', async (context) => {
    const principal = await requireMaintainer(
      context.req.header('authorization'),
      dependencies,
      'mutation',
    );
    const importId = parseImportId(context.req.param('import_id'));
    const body = await readValidatedJson(
      context.req.raw,
      catalogCancelRequestSchema,
      ADMIN_BODY_LIMIT,
    );
    return context.json(
      catalogCancelResponseSchema.parse(
        await dependencies.cancel(
          principal.user.id,
          importId,
          context.get('requestId'),
          body,
        ),
      ),
    );
  });

  app.get('/v1/admin/catalog/imports/:import_id', async (context) => {
    await requireMaintainer(
      context.req.header('authorization'),
      dependencies,
      'read',
    );
    const importId = parseImportId(context.req.param('import_id'));
    return context.json(
      catalogImportStatusSchema.parse(await dependencies.getStatus(importId)),
    );
  });
}
