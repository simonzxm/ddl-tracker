import { parseUuidV7, type CommentRevisionPage } from '@ddl-tracker/contracts';
import type { Hono } from 'hono';

import type { AuthenticatedPrincipal } from '../auth/account-service.js';
import type { AppVariables } from './app.js';
import { authenticateBearer } from './bearer.js';
import { HttpError } from './errors.js';

export interface CommentHistoryRouteDependencies {
  authenticate(token: string): Promise<AuthenticatedPrincipal>;
  list(input: {
    commentId: string;
    userId: string;
    maintainer: boolean;
    afterRevision: number;
    limit: number;
  }): Promise<CommentRevisionPage>;
}

function pathId(value: string): string {
  try {
    return parseUuidV7(value);
  } catch {
    throw new HttpError({
      code: 'invalid_request',
      message: 'Comment ID is invalid.',
      status: 400,
    });
  }
}

function nonnegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw invalidPagination();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw invalidPagination();
  }
  return parsed;
}

function limit(value: string | undefined): number {
  const parsed = nonnegativeInteger(value, 50);
  if (parsed < 1 || parsed > 100) throw invalidPagination();
  return parsed;
}

function invalidPagination(): HttpError {
  return new HttpError({
    code: 'invalid_request',
    message: 'Comment history pagination is invalid.',
    status: 400,
  });
}

export function registerCommentHistoryRoutes(
  app: Hono<{ Variables: AppVariables }>,
  dependencies: CommentHistoryRouteDependencies,
): void {
  app.get('/v1/comments/:comment_id/revisions', async (context) => {
    const principal = await authenticateBearer(
      context.req.header('authorization'),
      (token) => dependencies.authenticate(token),
    );
    return context.json(
      await dependencies.list({
        commentId: pathId(context.req.param('comment_id')),
        userId: principal.user.id,
        maintainer: principal.roles.includes('maintainer'),
        afterRevision: nonnegativeInteger(
          context.req.query('after_revision'),
          0,
        ),
        limit: limit(context.req.query('limit')),
      }),
    );
  });
}
