import {
  parseUuidV7,
  type ClassSectionWire,
  type CourseWire,
  type TermWire,
} from '@ddl-tracker/contracts';
import type { Hono } from 'hono';

import type { AuthenticatedPrincipal } from '../auth/account-service.js';
import type { AppVariables } from './app.js';
import { authenticateBearer } from './bearer.js';
import { HttpError } from './errors.js';

export interface CatalogRouteDependencies {
  authenticate(token: string): Promise<AuthenticatedPrincipal>;
  rateLimit(userId: string): Promise<void>;
  listTerms(): Promise<TermWire[]>;
  listCourses(termId: string): Promise<CourseWire[]>;
  listClassSections(courseId: string): Promise<ClassSectionWire[]>;
}

function parsePathId(value: string, name: string): string {
  try {
    return parseUuidV7(value);
  } catch {
    throw new HttpError({
      code: 'invalid_request',
      message: `${name} is invalid.`,
      status: 400,
    });
  }
}

async function requirePrincipal(
  authorization: string | undefined,
  dependencies: CatalogRouteDependencies,
): Promise<void> {
  const principal = await authenticateBearer(authorization, (token) =>
    dependencies.authenticate(token),
  );
  await dependencies.rateLimit(principal.user.id);
}

export function registerCatalogRoutes(
  app: Hono<{ Variables: AppVariables }>,
  dependencies: CatalogRouteDependencies,
): void {
  app.get('/v1/terms', async (context) => {
    await requirePrincipal(context.req.header('authorization'), dependencies);
    return context.json({ terms: await dependencies.listTerms() });
  });

  app.get('/v1/terms/:term_id/courses', async (context) => {
    await requirePrincipal(context.req.header('authorization'), dependencies);
    const termId = parsePathId(context.req.param('term_id'), 'Term ID');
    return context.json({ courses: await dependencies.listCourses(termId) });
  });

  app.get('/v1/courses/:course_id/class-sections', async (context) => {
    await requirePrincipal(context.req.header('authorization'), dependencies);
    const courseId = parsePathId(context.req.param('course_id'), 'Course ID');
    return context.json({
      class_sections: await dependencies.listClassSections(courseId),
    });
  });
}
