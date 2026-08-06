import { describe, expect, it } from 'vitest';

import { createApp } from '../src/http/app.js';
import { openApiDocument } from '../src/openapi.js';

const HTTP_METHODS = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
]);

type JsonSchema = Record<string, unknown>;

function referencedName(reference: string): string {
  const prefix = '#/components/schemas/';
  expect(reference).toMatch(/^#\/components\/schemas\/[A-Za-z0-9]+$/u);
  return reference.slice(prefix.length);
}

function assertClosedFixedObjects(
  schema: unknown,
  schemas: Record<string, JsonSchema>,
  location: string,
  visitedReferences = new Set<string>(),
): void {
  if (Array.isArray(schema)) {
    schema.forEach((entry, index) => {
      assertClosedFixedObjects(
        entry,
        schemas,
        `${location}[${String(index)}]`,
        visitedReferences,
      );
    });
    return;
  }
  if (typeof schema !== 'object' || schema === null) return;

  const record = schema as JsonSchema;
  const reference = record['$ref'];
  if (typeof reference === 'string') {
    const name = referencedName(reference);
    if (visitedReferences.has(name)) return;
    visitedReferences.add(name);
    const component = schemas[name];
    expect(component, `${location} -> ${name}`).toBeDefined();
    assertClosedFixedObjects(
      component,
      schemas,
      `${location} -> ${name}`,
      visitedReferences,
    );
    return;
  }

  if (record['type'] === 'object') {
    const properties = record['properties'];
    const additionalProperties = record['additionalProperties'];
    if (typeof properties === 'object' && properties !== null) {
      expect(additionalProperties, location).toBe(false);
    } else {
      expect(
        typeof additionalProperties === 'object' &&
          additionalProperties !== null,
        `${location} must be either a closed object or an explicit dynamic map`,
      ).toBe(true);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    assertClosedFixedObjects(
      value,
      schemas,
      `${location}.${key}`,
      visitedReferences,
    );
  }
}

describe('OpenAPI document', () => {
  it('documents every implemented path with contract components', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.info.version).toBe('4.0.0');
    expect(openApiDocument.servers).toEqual([{ url: '/api' }]);
    expect(Object.keys(openApiDocument.paths).length).toBeGreaterThan(0);
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
    expect(JSON.stringify(openApiDocument.paths)).not.toContain(
      '/v1/admin/catalog/imports',
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

  it('binds every JSON response to recursively exact named components', () => {
    const schemas = openApiDocument.components.schemas as Record<
      string,
      JsonSchema
    >;
    expect(schemas).not.toHaveProperty('GenericResult');
    expect(schemas).not.toHaveProperty('GenericPage');
    expect(JSON.stringify(schemas)).not.toContain(
      '"additionalProperties":true',
    );

    for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (
          !HTTP_METHODS.has(method) ||
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
          const location = `${method.toUpperCase()} ${path} ${status}`;
          const json = response.content?.['application/json'];
          if (json === undefined) {
            expect(['204', '302'], location).toContain(status);
            continue;
          }
          const reference = json.schema?.$ref;
          expect(reference, location).toBeDefined();
          if (reference === undefined) continue;
          const name = referencedName(reference);
          const component = schemas[name];
          expect(component, `${location} -> ${name}`).toBeDefined();
          assertClosedFixedObjects(
            component,
            schemas,
            `${location} -> ${name}`,
            new Set([name]),
          );
        }
      }
    }
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
