import {
  adminBootstrapRequestSchema,
  adminContentActionRequestSchema,
  adminReportResolutionRequestSchema,
  adminRoleRequestSchema,
  adminTaskMergeRequestSchema,
  adminUserActionRequestSchema,
  parseUuidV7,
} from '@ddl-tracker/contracts';
import type { Hono } from 'hono';

import type { AuthenticatedPrincipal } from '../auth/account-service.js';
import type { AppVariables } from './app.js';
import { authenticateBearer } from './bearer.js';
import { HttpError } from './errors.js';
import { readValidatedJson } from './json-body.js';

const ADMIN_BODY_LIMIT = 64 * 1024;

type ContentTargetType = 'course_task' | 'proposal' | 'comment';
type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface AdminRouteDependencies {
  authenticate(token: string): Promise<AuthenticatedPrincipal>;
  rateLimitRead(userId: string): Promise<void>;
  rateLimitMutation(userId: string): Promise<void>;
  bootstrap(input: {
    actorId: string;
    requestId: string;
    bootstrapToken: string;
  }): Promise<{ maintainer: true }>;
  setContentHidden(input: {
    actorId: string;
    targetType: ContentTargetType;
    targetId: string;
    hidden: boolean;
    reason: string;
    requestId: string;
  }): Promise<{ state: 'visible' | 'hidden'; revision: number; changed: boolean }>;
  listReports(input: {
    status?: ReportStatus;
    limit: number;
    afterCreatedAt?: Date;
    afterId?: string;
  }): Promise<unknown>;
  resolveReport(input: {
    actorId: string;
    reportId: string;
    status: 'resolved' | 'dismissed';
    resolution: string;
    requestId: string;
  }): Promise<unknown>;
  setUserSuspended(input: {
    actorId: string;
    targetUserId: string;
    suspended: boolean;
    reason: string;
    requestId: string;
  }): Promise<unknown>;
  setMaintainerRole(input: {
    actorId: string;
    targetUserId: string;
    maintainer: boolean;
    reason: string;
    requestId: string;
  }): Promise<unknown>;
  listAudit(input: {
    limit: number;
    afterCreatedAt?: Date;
    afterId?: string;
  }): Promise<unknown>;
  mergeTask(input: {
    actorId: string;
    sourceTaskId: string;
    targetTaskId: string;
    reason: string;
    requestId: string;
  }): Promise<unknown>;
}

async function principal(
  authorization: string | undefined,
  dependencies: AdminRouteDependencies,
): Promise<AuthenticatedPrincipal> {
  return authenticateBearer(authorization, (token) =>
    dependencies.authenticate(token),
  );
}

async function maintainer(
  authorization: string | undefined,
  dependencies: AdminRouteDependencies,
  kind: 'read' | 'mutation',
): Promise<AuthenticatedPrincipal> {
  const value = await principal(authorization, dependencies);
  if (!value.roles.includes('maintainer')) {
    throw new HttpError({
      code: 'forbidden',
      message: 'Maintainer role is required.',
      status: 403,
    });
  }
  if (kind === 'read') {
    await dependencies.rateLimitRead(value.user.id);
  } else {
    await dependencies.rateLimitMutation(value.user.id);
  }
  return value;
}

function pathId(value: string, label: string): string {
  try {
    return parseUuidV7(value);
  } catch {
    throw new HttpError({
      code: 'invalid_request',
      message: `${label} is invalid.`,
      status: 400,
    });
  }
}

function limit(value: string | undefined): number {
  if (value === undefined) return 50;
  if (!/^\d+$/u.test(value)) throw invalidPagination();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw invalidPagination();
  }
  return parsed;
}

function date(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw invalidPagination();
  }
  return parsed;
}

function reportStatus(value: string | undefined): ReportStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'open' || value === 'resolved' || value === 'dismissed') {
    return value;
  }
  throw invalidPagination();
}

function pagination(context: {
  query(name: string): string | undefined;
}): {
  limit: number;
  afterCreatedAt?: Date;
  afterId?: string;
} {
  const afterCreatedAt = date(context.query('after_created_at'));
  const rawAfterId = context.query('after_id');
  if ((afterCreatedAt === undefined) !== (rawAfterId === undefined)) {
    throw invalidPagination();
  }
  return {
    limit: limit(context.query('limit')),
    ...(afterCreatedAt === undefined
      ? {}
      : {
          afterCreatedAt,
          afterId: pathId(rawAfterId ?? '', 'After ID'),
        }),
  };
}

function invalidPagination(): HttpError {
  return new HttpError({
    code: 'invalid_request',
    message: 'Admin pagination is invalid.',
    status: 400,
  });
}

export function registerAdminRoutes(
  app: Hono<{ Variables: AppVariables }>,
  dependencies: AdminRouteDependencies,
): void {
  app.post('/v1/admin/bootstrap', async (context) => {
    const actor = await principal(
      context.req.header('authorization'),
      dependencies,
    );
    await dependencies.rateLimitMutation(actor.user.id);
    const body = await readValidatedJson(
      context.req.raw,
      adminBootstrapRequestSchema,
      ADMIN_BODY_LIMIT,
    );
    return context.json(
      await dependencies.bootstrap({
        actorId: actor.user.id,
        requestId: context.get('requestId'),
        bootstrapToken: body.bootstrap_token,
      }),
    );
  });

  app.get('/v1/admin/reports', async (context) => {
    await maintainer(
      context.req.header('authorization'),
      dependencies,
      'read',
    );
    const status = reportStatus(context.req.query('status'));
    return context.json(
      await dependencies.listReports({
        ...pagination(context.req),
        ...(status === undefined ? {} : { status }),
      }),
    );
  });

  app.post('/v1/admin/reports/:report_id/resolve', async (context) => {
    const actor = await maintainer(
      context.req.header('authorization'),
      dependencies,
      'mutation',
    );
    const body = await readValidatedJson(
      context.req.raw,
      adminReportResolutionRequestSchema,
      ADMIN_BODY_LIMIT,
    );
    return context.json(
      await dependencies.resolveReport({
        actorId: actor.user.id,
        reportId: pathId(context.req.param('report_id'), 'Report ID'),
        status: body.status,
        resolution: body.resolution,
        requestId: context.get('requestId'),
      }),
    );
  });

  for (const hidden of [true, false] as const) {
    const action = hidden ? 'hide' : 'restore';
    app.post(`/v1/admin/content/:content_id/${action}`, async (context) => {
      const actor = await maintainer(
        context.req.header('authorization'),
        dependencies,
        'mutation',
      );
      const body = await readValidatedJson(
        context.req.raw,
        adminContentActionRequestSchema,
        ADMIN_BODY_LIMIT,
      );
      return context.json(
        await dependencies.setContentHidden({
          actorId: actor.user.id,
          targetType: body.target_type,
          targetId: pathId(context.req.param('content_id'), 'Content ID'),
          hidden,
          reason: body.reason,
          requestId: context.get('requestId'),
        }),
      );
    });
  }

  for (const suspended of [true, false] as const) {
    const action = suspended ? 'suspend' : 'restore';
    app.post(`/v1/admin/users/:user_id/${action}`, async (context) => {
      const actor = await maintainer(
        context.req.header('authorization'),
        dependencies,
        'mutation',
      );
      const body = await readValidatedJson(
        context.req.raw,
        adminUserActionRequestSchema,
        ADMIN_BODY_LIMIT,
      );
      return context.json(
        await dependencies.setUserSuspended({
          actorId: actor.user.id,
          targetUserId: pathId(context.req.param('user_id'), 'User ID'),
          suspended,
          reason: body.reason,
          requestId: context.get('requestId'),
        }),
      );
    });
  }

  app.post('/v1/admin/users/:user_id/roles', async (context) => {
    const actor = await maintainer(
      context.req.header('authorization'),
      dependencies,
      'mutation',
    );
    const body = await readValidatedJson(
      context.req.raw,
      adminRoleRequestSchema,
      ADMIN_BODY_LIMIT,
    );
    return context.json(
      await dependencies.setMaintainerRole({
        actorId: actor.user.id,
        targetUserId: pathId(context.req.param('user_id'), 'User ID'),
        maintainer: body.maintainer,
        reason: body.reason,
        requestId: context.get('requestId'),
      }),
    );
  });

  app.post('/v1/admin/tasks/:source_task_id/merge', async (context) => {
    const actor = await maintainer(
      context.req.header('authorization'),
      dependencies,
      'mutation',
    );
    const body = await readValidatedJson(
      context.req.raw,
      adminTaskMergeRequestSchema,
      ADMIN_BODY_LIMIT,
    );
    return context.json(
      await dependencies.mergeTask({
        actorId: actor.user.id,
        sourceTaskId: pathId(
          context.req.param('source_task_id'),
          'Source task ID',
        ),
        targetTaskId: body.target_task_id,
        reason: body.reason,
        requestId: context.get('requestId'),
      }),
    );
  });

  app.get('/v1/admin/audit', async (context) => {
    await maintainer(
      context.req.header('authorization'),
      dependencies,
      'read',
    );
    return context.json(await dependencies.listAudit(pagination(context.req)));
  });
}
