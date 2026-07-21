import { describe, expect, it } from 'vitest';

import { createApp } from '../src/http/app.js';
import { openApiDocument } from '../src/openapi.js';

const expectedPaths = [
  '/health/live',
  '/health/ready',
  '/v1/auth/email/challenges',
  '/v1/auth/email/verifications',
  '/v1/accounts/registrations',
  '/v1/me',
  '/v1/me/profile',
  '/v1/sessions',
  '/v1/sessions/{session_id}',
  '/v1/terms',
  '/v1/terms/{term_id}/courses',
  '/v1/courses/{course_id}/class-sections',
  '/v1/comments/{comment_id}/revisions',
  '/v1/sync',
  '/v1/admin/bootstrap',
  '/v1/admin/catalog/imports/plan',
  '/v1/admin/catalog/imports/{import_id}/apply',
  '/v1/admin/catalog/imports/{import_id}',
  '/v1/admin/reports',
  '/v1/admin/reports/{report_id}/resolve',
  '/v1/admin/content/{content_id}/hide',
  '/v1/admin/content/{content_id}/restore',
  '/v1/admin/users/{user_id}/suspend',
  '/v1/admin/users/{user_id}/restore',
  '/v1/admin/users/{user_id}/roles',
  '/v1/admin/tasks/{source_task_id}/merge',
  '/v1/admin/audit',
];

describe('OpenAPI document', () => {
  it('documents every implemented path with contract components', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.servers).toEqual([{ url: '/api' }]);
    expect(Object.keys(openApiDocument.paths).sort()).toEqual(
      expectedPaths.sort(),
    );
    expect(openApiDocument.components.securitySchemes).toHaveProperty(
      'bearerAuth',
    );
    expect(openApiDocument.components.schemas).toHaveProperty('SyncRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('ApiError');
  });

  it('documents retry metadata on every bearer-protected operation', () => {
    for (const pathItem of Object.values(openApiDocument.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (
          typeof operation === 'object' &&
          operation !== null &&
          'security' in operation &&
          'responses' in operation
        ) {
          expect(operation.responses).toMatchObject({
            '429': {
              headers: {
                'Retry-After': {
                  schema: { type: 'integer', minimum: 1 },
                },
              },
            },
          });
        }
      }
    }
  });

  it('contains no runtime secret names or configured values', () => {
    const serialized = JSON.stringify(openApiDocument);
    for (const forbidden of [
      'OTP_HMAC_SECRET',
      'TOKEN_PEPPER',
      'SYNC_TOKEN_SECRET',
      'MAINTAINER_BOOTSTRAP_TOKEN',
      'SMTP_PASSWORD',
      'postgresql://',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('is served without touching readiness or database dependencies', async () => {
    let readyCalls = 0;
    const response = await createApp({
      checkReady: async () => {
        readyCalls += 1;
        return true;
      },
    }).request('/api/openapi.json');

    expect(response.status).toBe(200);
    expect((await response.json()) as { openapi: string }).toMatchObject({
      openapi: '3.1.0',
    });
    expect(readyCalls).toBe(0);
  });
});
