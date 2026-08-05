import { describe, expect, it } from 'vitest';

import { createApp } from '../src/http/app.js';
import { openApiDocument } from '../src/openapi.js';

const expectedPaths = [
  '/health/live',
  '/health/ready',
  '/v1/auth/oidc/start',
  '/v1/auth/oidc/callback',
  '/v1/auth/oidc/exchange',
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
  '/v1/admin/catalog/imports/upload',
  '/v1/admin/catalog/imports/{import_id}/apply-all',
  '/v1/admin/catalog/imports/{import_id}/cancel',
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
    expect(openApiDocument.info.version).toBe('3.0.0');
    expect(openApiDocument.servers).toEqual([{ url: '/api' }]);
    expect(Object.keys(openApiDocument.paths).sort()).toEqual(
      expectedPaths.sort(),
    );
    expect(openApiDocument.components.securitySchemes).toHaveProperty(
      'bearerAuth',
    );
    expect(openApiDocument.components.schemas).toHaveProperty('CurrentUser');
    expect(openApiDocument.components.schemas).toHaveProperty('OidcAuthorizationRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('OidcExchangeRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('SyncRequest');
    expect(openApiDocument.components.schemas).toHaveProperty('StudentOperation');
    expect(openApiDocument.components.schemas).toHaveProperty('SyncEvent');
    expect(openApiDocument.components.schemas).toHaveProperty('SnapshotRecord');
    expect(openApiDocument.components.schemas).toHaveProperty('ApiError');
    expect(openApiDocument.components.schemas).toHaveProperty(
      'CatalogApplyAllRequest',
    );
    expect(openApiDocument.components.schemas).toHaveProperty(
      'CatalogUploadResponse',
    );
    expect(openApiDocument.components.schemas).toHaveProperty(
      'CatalogCancelRequest',
    );
  });

  it('documents common errors on every bearer-protected operation', () => {
    for (const pathItem of Object.values(openApiDocument.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (
          typeof operation === 'object' &&
          operation !== null &&
          'security' in operation &&
          'responses' in operation
        ) {
          expect(operation.responses).toMatchObject({
            '400': { content: { 'application/json': expect.any(Object) } },
            '401': { content: { 'application/json': expect.any(Object) } },
            '403': { content: { 'application/json': expect.any(Object) } },
            '429': {
              headers: {
                'Retry-After': {
                  schema: { type: 'integer', minimum: 1 },
                },
              },
            },
            '500': { content: { 'application/json': expect.any(Object) } },
            '503': { content: { 'application/json': expect.any(Object) } },
          });
        }
      }
    }
  });

  it('binds every JSON success response to a strict named component', () => {
    const schemas = openApiDocument.components.schemas as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemas).not.toHaveProperty('GenericResult');
    expect(schemas).not.toHaveProperty('GenericPage');
    expect(JSON.stringify(schemas)).not.toContain(
      '"additionalProperties":true',
    );

    for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (
          typeof operation !== 'object' ||
          operation === null ||
          !('responses' in operation)
        ) {
          continue;
        }
        const responses = operation.responses as Record<
          string,
          { content?: Record<string, { schema?: { $ref?: string } }> }
        >;
        for (const [status, response] of Object.entries(responses)) {
          if (!status.startsWith('2')) continue;
          const json = response.content?.['application/json'];
          if (json === undefined) {
            expect(['204', '302'], `${method.toUpperCase()} ${path}`).toContain(
              status,
            );
            continue;
          }
          const reference = json.schema?.$ref;
          expect(reference, `${method.toUpperCase()} ${path}`).toMatch(
            /^#\/components\/schemas\/[A-Za-z0-9]+$/u,
          );
          const name = reference?.split('/').at(-1) ?? '';
          const schema = schemas[name];
          expect(schema, `${method.toUpperCase()} ${path}`).toBeDefined();
          if ('oneOf' in (schema ?? {})) {
            for (const option of schema?.oneOf as { $ref: string }[]) {
              const optionName = option.$ref.split('/').at(-1) ?? '';
              expect(schemas[optionName]?.additionalProperties).toBe(false);
            }
          } else {
            expect(
              schema?.additionalProperties,
              `${method.toUpperCase()} ${path} -> ${name}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('includes fixed upload and cancellation examples', () => {
    expect(
      openApiDocument.paths['/v1/admin/catalog/imports/upload'].post.responses[
        '200'
      ],
    ).toMatchObject({
      content: {
        'application/json': {
          example: { filename: 'courses.csv.gz', replayed: false },
        },
      },
    });
    expect(
      openApiDocument.paths['/v1/admin/catalog/imports/{import_id}/cancel'].post
        .requestBody,
    ).toMatchObject({
      content: {
        'application/json': {
          example: { reason: 'Superseded by a corrected source file.' },
        },
      },
    });
  });

  it('preserves UUIDv7 and RFC 3339 formats for generated clients', () => {
    expect(openApiDocument.components.schemas.PublicUser).toMatchObject({
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          pattern: expect.stringContaining('-7'),
        },
      },
    });
    expect(openApiDocument.components.schemas.Session).toMatchObject({
      properties: {
        created_at: { type: 'string', format: 'date-time' },
      },
    });
    expect(openApiDocument.components.schemas.ApiError).toMatchObject({
      properties: {
        request_id: { type: 'string', format: 'uuid' },
      },
    });
  });

  it('publishes typed sync unions with stable discriminators', () => {
    const schemas = openApiDocument.components.schemas as Record<
      string,
      Record<string, unknown>
    >;
    const syncEvent = schemas['SyncEvent'];
    const snapshotRecord = schemas['SnapshotRecord'];

    expect(syncEvent).toMatchObject({
      discriminator: {
        propertyName: 'type',
        mapping: expect.objectContaining({
          catalog_revision_changed:
            '#/components/schemas/SyncEventCatalogRevisionChanged',
        }),
      },
      oneOf: expect.arrayContaining([
        { $ref: '#/components/schemas/SyncEventCatalogRevisionChanged' },
      ]),
    });
    expect(snapshotRecord).toMatchObject({
      discriminator: {
        propertyName: 'record_type',
        mapping: expect.objectContaining({
          catalog_revision: '#/components/schemas/SnapshotRecordCatalogRevision',
        }),
      },
      oneOf: expect.arrayContaining([
        { $ref: '#/components/schemas/SnapshotRecordCatalogRevision' },
      ]),
    });
    expect(syncEvent).not.toHaveProperty('anyOf');
    expect(snapshotRecord).not.toHaveProperty('anyOf');
    expect(JSON.stringify(syncEvent)).not.toContain('"additionalProperties":{}');
    expect(JSON.stringify(snapshotRecord)).not.toContain(
      '"additionalProperties":{}',
    );

    expect(openApiDocument.components.schemas.SyncRequest).toMatchObject({
      discriminator: {
        propertyName: 'mode',
        mapping: expect.objectContaining({
          incremental: '#/components/schemas/SyncRequestIncremental',
        }),
      },
      oneOf: expect.arrayContaining([
        { $ref: '#/components/schemas/SyncRequestIncremental' },
      ]),
    });
    expect(openApiDocument.components.schemas.StudentOperation).toMatchObject({
      discriminator: {
        propertyName: 'type',
        mapping: expect.objectContaining({
          set_accuracy_vote:
            '#/components/schemas/StudentOperationSetAccuracyVote',
        }),
      },
      oneOf: expect.arrayContaining([
        { $ref: '#/components/schemas/StudentOperationSetAccuracyVote' },
      ]),
    });
    expect(
      schemas['SyncRequestAccountSnapshot'],
    ).toMatchObject({
      properties: {
        operations: {
          maxItems: 0,
          items: { $ref: '#/components/schemas/StudentOperation' },
        },
      },
    });
    expect(
      JSON.stringify(schemas['SyncRequestAccountSnapshot']),
    ).not.toContain('"not":{}');

    expect(
      openApiDocument.components.schemas.IncrementalSyncResponse,
    ).toMatchObject({
      properties: {
        events: {
          items: { $ref: '#/components/schemas/SyncEvent' },
        },
      },
    });
    expect(
      openApiDocument.components.schemas.AccountSnapshotResponse,
    ).toMatchObject({
      properties: {
        records: {
          items: { $ref: '#/components/schemas/SnapshotRecord' },
        },
      },
    });
  });

  it('contains no runtime secret names or configured values', () => {
    const serialized = JSON.stringify(openApiDocument);
    for (const forbidden of [
      'OIDC_TRANSACTION_SECRET',
      'TOKEN_PEPPER',
      'SYNC_TOKEN_SECRET',
      'MAINTAINER_BOOTSTRAP_TOKEN',
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
