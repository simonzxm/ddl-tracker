import {
  syncRequestSchema,
  syncResponseSchema,
  type SyncRequest,
  type SyncResponse,
} from '@ddl-tracker/contracts';
import type { Hono } from 'hono';

import type { AuthenticatedPrincipal } from '../auth/account-service.js';
import type { AppVariables } from './app.js';
import { authenticateBearer } from './bearer.js';
import { readValidatedJson } from './json-body.js';

const SYNC_BODY_LIMIT = 512 * 1024;

export interface SyncRouteDependencies {
  authenticate(token: string): Promise<AuthenticatedPrincipal>;
  rateLimit(userId: string): Promise<void>;
  handle(input: {
    userId: string;
    maintainer: boolean;
    requestId: string;
    request: SyncRequest;
  }): Promise<SyncResponse>;
}

export function registerSyncRoutes(
  app: Hono<{ Variables: AppVariables }>,
  dependencies: SyncRouteDependencies,
): void {
  app.post('/v1/sync', async (context) => {
    const principal = await authenticateBearer(
      context.req.header('authorization'),
      (token) => dependencies.authenticate(token),
    );
    await dependencies.rateLimit(principal.user.id);
    const request = await readValidatedJson(
      context.req.raw,
      syncRequestSchema,
      SYNC_BODY_LIMIT,
    );
    return context.json(
      syncResponseSchema.parse(
        await dependencies.handle({
          userId: principal.user.id,
          maintainer: principal.roles.includes('maintainer'),
          requestId: context.get('requestId'),
          request,
        }),
      ),
    );
  });
}
