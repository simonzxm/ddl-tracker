import { z, type ZodType } from 'zod';

import {
  API_CONTRACT_VERSION,
  accountSnapshotResponseSchema,
  adminBootstrapRequestSchema,
  adminContentActionRequestSchema,
  adminReportResolutionRequestSchema,
  adminRoleRequestSchema,
  adminTaskMergeRequestSchema,
  adminUserActionRequestSchema,
  apiErrorSchema,
  catalogApplyAllRequestSchema,
  catalogApplyResponseSchema,
  catalogCancelRequestSchema,
  catalogCancelResponseSchema,
  catalogImportStatusSchema,
  catalogPlanBatchRequestSchema,
  catalogPlanBatchResponseSchema,
  catalogUploadResponseSchema,
  classSectionSnapshotResponseSchema,
  classSectionsResponseSchema,
  commentRevisionPageSchema,
  coursesResponseSchema,
  currentUserSchema,
  incrementalSyncResponseSchema,
  oidcAuthorizationRequestSchema,
  oidcAuthorizationResponseSchema,
  oidcExchangeRequestSchema,
  profileUpdateRequestSchema,
  publicUserSchema,
  sessionSchema,
  sessionVerificationResponseSchema,
  snapshotRecordSchema,
  studentOperationSchema,
  syncEventSchema,
  syncRequestSchema,
  termsResponseSchema,
} from '@ddl-tracker/contracts';

function component(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-2020-12',
    unrepresentable: 'any',
  });
}

interface NamedDiscriminatedComponents {
  root: Record<string, unknown>;
  components: Record<string, Record<string, unknown>>;
}

function pascalCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function namedDiscriminatedComponents(
  schema: ZodType & { options: readonly ZodType[] },
  propertyName: string,
  prefix: string,
): NamedDiscriminatedComponents {
  const components: Record<string, Record<string, unknown>> = {};
  const mapping: Record<string, string> = {};
  const oneOf: { $ref: string }[] = [];

  for (const option of schema.options) {
    const shape = (option as unknown as {
      shape: Record<string, { value?: unknown }>;
    }).shape;
    const discriminator = shape[propertyName]?.value;
    if (typeof discriminator !== 'string') {
      throw new Error(
        `OpenAPI ${prefix} option is missing literal ${propertyName}.`,
      );
    }
    const name = `${prefix}${pascalCase(discriminator)}`;
    const reference = `#/components/schemas/${name}`;
    components[name] = component(option);
    mapping[discriminator] = reference;
    oneOf.push({ $ref: reference });
  }

  return {
    root: {
      oneOf,
      discriminator: { propertyName, mapping },
    },
    components,
  };
}

function withArrayItemReference(
  schema: ZodType,
  propertyName: string,
  schemaName: string,
): Record<string, unknown> {
  return setArrayItemReference(component(schema), propertyName, schemaName);
}

function setArrayItemReference(
  value: Record<string, unknown>,
  propertyName: string,
  schemaName: string,
): Record<string, unknown> {
  const properties = objectValue(value.properties, 'schema properties');
  const property = objectValue(
    properties[propertyName],
    `${propertyName} property`,
  );
  property.items = { $ref: `#/components/schemas/${schemaName}` };
  return value;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`OpenAPI ${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

const jsonContent = (schemaRef: string) => ({
  'application/json': {
    schema: { $ref: `#/components/schemas/${schemaRef}` },
  },
});

const requestBody = (schemaRef: string) => ({
  required: true,
  content: jsonContent(schemaRef),
});

const response = (description: string, schemaRef?: string) => ({
  description,
  ...(schemaRef === undefined ? {} : { content: jsonContent(schemaRef) }),
});

const importExampleId = '018f0000-0000-7000-8000-000000000001';
const emptyImportDiffExample = {
  terms: { added: 0, updated: 0, unchanged: 1, deactivated: 0 },
  courses: { added: 0, updated: 0, unchanged: 1, deactivated: 0 },
  class_sections: { added: 0, updated: 0, unchanged: 1, deactivated: 0 },
  field_changes: {},
  deactivated_courses: [],
  deactivated_class_sections: [],
  deactivated_class_section_ids: [],
  checksum_previously_applied: false,
};

const bearer = [{ bearerAuth: [] }];
const protectedErrorResponses = {
  '400': response('Invalid request.', 'ApiError'),
  '401': response('Authentication required.', 'ApiError'),
  '403': response('Authenticated account is not allowed.', 'ApiError'),
  '500': response('Unexpected server failure.', 'ApiError'),
  '503': response('Service temporarily unavailable.', 'ApiError'),
};
const rateLimitedResponse = {
  description: 'Persistent request limit exceeded.',
  headers: {
    'Retry-After': {
      description: 'Whole seconds before another request should be attempted.',
      schema: { type: 'integer', minimum: 1 },
    },
  },
  content: jsonContent('ApiError'),
};
const uuidParameter = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', format: 'uuid' },
});
const paginationParameters = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  },
];

const syncRequestComponents = namedDiscriminatedComponents(
  syncRequestSchema,
  'mode',
  'SyncRequest',
);
const studentOperationComponents = namedDiscriminatedComponents(
  studentOperationSchema,
  'type',
  'StudentOperation',
);
const syncEventComponents = namedDiscriminatedComponents(
  syncEventSchema,
  'type',
  'SyncEvent',
);
const snapshotRecordComponents = namedDiscriminatedComponents(
  snapshotRecordSchema,
  'record_type',
  'SnapshotRecord',
);
for (const requestName of [
  'SyncRequestAccountSnapshot',
  'SyncRequestClassSectionSnapshot',
  'SyncRequestIncremental',
]) {
  const request = syncRequestComponents.components[requestName];
  if (request === undefined) {
    throw new Error(`OpenAPI ${requestName} component is missing.`);
  }
  setArrayItemReference(request, 'operations', 'StudentOperation');
}

export const openApiDocument = addRateLimitResponses({
  openapi: '3.1.0',
  info: {
    title: 'DDL Tracker API',
    version: API_CONTRACT_VERSION,
    description:
      'OIDC-authenticated course deadline tracking, offline synchronization, catalog administration, and moderation API.',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'health' },
    { name: 'auth' },
    { name: 'catalog' },
    { name: 'comments' },
    { name: 'sync' },
    { name: 'admin' },
  ],
  paths: {
    '/health/live': {
      get: {
        tags: ['health'],
        summary: 'Worker liveness',
        responses: { '200': response('Worker handler is live.', 'Health') },
      },
    },
    '/health/ready': {
      get: {
        tags: ['health'],
        summary: 'Database readiness',
        responses: {
          '200': response('Database is ready.', 'Health'),
          '503': response('Database is unavailable.', 'ApiError'),
        },
      },
    },
    '/v1/auth/oidc/start': {
      post: {
        tags: ['auth'],
        summary: 'Start an OIDC authorization',
        requestBody: requestBody('OidcAuthorizationRequest'),
        responses: {
          '200': response('Authorization started.', 'OidcAuthorizationResponse'),
          '400': response('Invalid or disallowed redirect URI.', 'ApiError'),
          '429': response('Login attempts rate limited.', 'ApiError'),
          '503': response('OIDC provider unavailable.', 'ApiError'),
        },
      },
    },
    '/v1/auth/oidc/callback': {
      get: {
        tags: ['auth'],
        summary: 'Complete the OIDC provider callback',
        parameters: [
          { name: 'state', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'code', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'error', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '302': {
            description: 'Redirect to the approved client callback with a one-time code or error.',
            headers: {
              Location: { schema: { type: 'string', format: 'uri' } },
            },
          },
          '400': response('Invalid or expired authorization.', 'ApiError'),
        },
      },
    },
    '/v1/auth/oidc/exchange': {
      post: {
        tags: ['auth'],
        summary: 'Exchange a one-time OIDC code for a local session',
        requestBody: requestBody('OidcExchangeRequest'),
        responses: {
          '200': response('Local session created.', 'SessionVerificationResponse'),
          '400': response('Invalid or expired exchange code.', 'ApiError'),
        },
      },
    },
    '/v1/me': {
      get: {
        tags: ['auth'],
        summary: 'Read the current public profile',
        security: bearer,
        responses: {
          '200': response('Current user.', 'CurrentUser'),
          '401': response('Authentication required.', 'ApiError'),
        },
      },
      delete: {
        tags: ['auth'],
        summary: 'Delete the current account',
        security: bearer,
        responses: {
          '204': response('Account deleted.'),
          '401': response('Authentication required.', 'ApiError'),
          '409': response('Last maintainer protection.', 'ApiError'),
        },
      },
    },
    '/v1/me/profile': {
      patch: {
        tags: ['auth'],
        summary: 'Update the current public profile',
        security: bearer,
        requestBody: requestBody('ProfileUpdateRequest'),
        responses: {
          '200': response('Updated user.', 'CurrentUser'),
          '409': response('Revision or username conflict.', 'ApiError'),
        },
      },
    },
    '/v1/sessions': {
      get: {
        tags: ['auth'],
        summary: 'List current account sessions',
        security: bearer,
        responses: { '200': response('Session list.', 'SessionList') },
      },
      delete: {
        tags: ['auth'],
        summary: 'Revoke every account session',
        security: bearer,
        responses: { '204': response('Sessions revoked.') },
      },
    },
    '/v1/sessions/{session_id}': {
      delete: {
        tags: ['auth'],
        summary: 'Revoke one account session',
        security: bearer,
        parameters: [uuidParameter('session_id', 'Session UUIDv7.')],
        responses: {
          '204': response('Session revoked.'),
          '404': response('Session not found.', 'ApiError'),
        },
      },
    },
    '/v1/terms': {
      get: {
        tags: ['catalog'],
        summary: 'List academic terms',
        security: bearer,
        responses: { '200': response('Academic terms.', 'TermsResponse') },
      },
    },
    '/v1/terms/{term_id}/courses': {
      get: {
        tags: ['catalog'],
        summary: 'List courses in a term',
        security: bearer,
        parameters: [uuidParameter('term_id', 'Academic term UUIDv7.')],
        responses: { '200': response('Courses.', 'CoursesResponse') },
      },
    },
    '/v1/courses/{course_id}/class-sections': {
      get: {
        tags: ['catalog'],
        summary: 'List class sections in a course',
        security: bearer,
        parameters: [uuidParameter('course_id', 'Course UUIDv7.')],
        responses: {
          '200': response('Class sections.', 'ClassSectionsResponse'),
        },
      },
    },
    '/v1/comments/{comment_id}/revisions': {
      get: {
        tags: ['comments'],
        summary: 'Read comment revision history',
        security: bearer,
        parameters: [
          uuidParameter('comment_id', 'Comment UUIDv7.'),
          {
            name: 'after_revision',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0, default: 0 },
          },
          ...paginationParameters,
        ],
        responses: {
          '200': response('Comment revisions.', 'CommentRevisionPage'),
          '403': response('Retained history is hidden.', 'ApiError'),
        },
      },
    },
    '/v1/sync': {
      post: {
        tags: ['sync'],
        summary: 'Push operations and pull incremental or snapshot state',
        security: bearer,
        requestBody: requestBody('SyncRequest'),
        responses: {
          '200': response('Sync result.', 'SyncResponse'),
          '409': response('Cursor expired or state conflict.', 'ApiError'),
          '413': response('Payload too large.', 'ApiError'),
        },
      },
    },
    '/v1/admin/bootstrap': {
      post: {
        tags: ['admin'],
        summary: 'Bootstrap the first maintainer',
        security: bearer,
        requestBody: requestBody('AdminBootstrapRequest'),
        responses: {
          '200': response('Maintainer bootstrapped.', 'GenericResult'),
          '403': response('Bootstrap token rejected.', 'ApiError'),
          '409': response('Bootstrap already closed.', 'ApiError'),
        },
      },
    },
    '/v1/admin/catalog/imports/plan': {
      post: {
        tags: ['admin'],
        summary: 'Upload and plan a catalog import batch',
        security: bearer,
        requestBody: requestBody('CatalogPlanBatchRequest'),
        responses: {
          '200': response('Catalog import plan progress.', 'CatalogPlanBatchResponse'),
        },
      },
    },
    '/v1/admin/catalog/imports/upload': {
      post: {
        tags: ['admin'],
        summary: 'Upload one gzip catalog and create a complete import plan',
        security: bearer,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['catalog', 'manifest'],
                properties: {
                  catalog: {
                    type: 'string',
                    format: 'binary',
                    description: 'A gzip-compressed UTF-8 CSV named *.csv.gz.',
                  },
                  manifest: {
                    type: 'string',
                    format: 'binary',
                    description: 'The matching UTF-8 JSON manifest.',
                  },
                },
                additionalProperties: false,
              },
              example: {
                catalog: 'courses.csv.gz (binary)',
                manifest: 'manifest.json (binary)',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Complete catalog import plan.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CatalogUploadResponse',
                },
                example: {
                  import_id: importExampleId,
                  replayed: false,
                  filename: 'courses.csv.gz',
                  checksum: 'a'.repeat(64),
                  manifest_hash: 'b'.repeat(64),
                  row_count: 3025,
                  course_count: 1890,
                  class_section_count: 3025,
                  total_batches: 31,
                  warnings: [],
                  diff: emptyImportDiffExample,
                },
              },
            },
          },
          '413': response('Compressed or expanded payload too large.', 'ApiError'),
          '415': response('Multipart content type required.', 'ApiError'),
        },
      },
    },
    '/v1/admin/catalog/imports/{import_id}/apply-all': {
      post: {
        tags: ['admin'],
        summary: 'Atomically apply a complete catalog import',
        security: bearer,
        parameters: [uuidParameter('import_id', 'Catalog import UUIDv7.')],
        requestBody: requestBody('CatalogApplyAllRequest'),
        responses: {
          '200': response('Catalog import applied.', 'CatalogApplyResponse'),
          '409': response('Baseline or confirmation conflict.', 'ApiError'),
        },
      },
    },
    '/v1/admin/catalog/imports/{import_id}/cancel': {
      post: {
        tags: ['admin'],
        summary: 'Cancel a planned catalog import',
        security: bearer,
        parameters: [uuidParameter('import_id', 'Catalog import UUIDv7.')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CatalogCancelRequest',
              },
              example: { reason: 'Superseded by a corrected source file.' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Catalog import cancelled.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CatalogCancelResponse',
                },
                example: {
                  import_id: importExampleId,
                  status: 'cancelled',
                  replayed: false,
                },
              },
            },
          },
          '409': response('Catalog import is already terminal.', 'ApiError'),
        },
      },
    },
    '/v1/admin/catalog/imports/{import_id}': {
      get: {
        tags: ['admin'],
        summary: 'Read catalog import status',
        security: bearer,
        parameters: [uuidParameter('import_id', 'Catalog import UUIDv7.')],
        responses: {
          '200': response('Catalog import status.', 'CatalogImportStatus'),
        },
      },
    },
    '/v1/admin/reports': {
      get: {
        tags: ['admin'],
        summary: 'List private content reports',
        security: bearer,
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['open', 'resolved', 'dismissed'] },
          },
          ...paginationParameters,
        ],
        responses: { '200': response('Private report page.', 'GenericPage') },
      },
    },
    '/v1/admin/reports/{report_id}/resolve': {
      post: {
        tags: ['admin'],
        summary: 'Resolve or dismiss a content report',
        security: bearer,
        parameters: [uuidParameter('report_id', 'Report UUIDv7.')],
        requestBody: requestBody('AdminReportResolutionRequest'),
        responses: { '200': response('Report disposition.', 'GenericResult') },
      },
    },
    '/v1/admin/content/{content_id}/hide': adminContentOperation(
      'Hide shared content',
    ),
    '/v1/admin/content/{content_id}/restore': adminContentOperation(
      'Restore shared content',
    ),
    '/v1/admin/users/{user_id}/suspend': adminUserOperation('Suspend a user'),
    '/v1/admin/users/{user_id}/restore': adminUserOperation('Restore a user'),
    '/v1/admin/users/{user_id}/roles': {
      post: {
        tags: ['admin'],
        summary: 'Grant or revoke the maintainer role',
        security: bearer,
        parameters: [uuidParameter('user_id', 'User UUIDv7.')],
        requestBody: requestBody('AdminRoleRequest'),
        responses: { '200': response('Role result.', 'GenericResult') },
      },
    },
    '/v1/admin/tasks/{source_task_id}/merge': {
      post: {
        tags: ['admin'],
        summary: 'Merge a duplicate task into a canonical task',
        security: bearer,
        parameters: [uuidParameter('source_task_id', 'Source task UUIDv7.')],
        requestBody: requestBody('AdminTaskMergeRequest'),
        responses: {
          '200': response('Task merge result.', 'GenericResult'),
          '409': response('Merge invariant rejected.', 'ApiError'),
        },
      },
    },
    '/v1/admin/audit': {
      get: {
        tags: ['admin'],
        summary: 'List append-only management audit entries',
        security: bearer,
        parameters: paginationParameters,
        responses: { '200': response('Audit page.', 'GenericPage') },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
    },
    schemas: {
      ApiError: component(apiErrorSchema),
      OidcAuthorizationRequest: component(oidcAuthorizationRequestSchema),
      OidcAuthorizationResponse: component(oidcAuthorizationResponseSchema),
      OidcExchangeRequest: component(oidcExchangeRequestSchema),
      SessionVerificationResponse: component(
        sessionVerificationResponseSchema,
      ),
      PublicUser: component(publicUserSchema),
      CurrentUser: component(currentUserSchema),
      ProfileUpdateRequest: component(profileUpdateRequestSchema),
      Session: component(sessionSchema),
      SessionList: {
        type: 'object',
        required: ['sessions'],
        properties: {
          sessions: { type: 'array', items: { $ref: '#/components/schemas/Session' } },
        },
        additionalProperties: false,
      },
      TermsResponse: component(termsResponseSchema),
      CoursesResponse: component(coursesResponseSchema),
      ClassSectionsResponse: component(classSectionsResponseSchema),
      CommentRevisionPage: component(commentRevisionPageSchema),
      ...syncRequestComponents.components,
      ...studentOperationComponents.components,
      ...syncEventComponents.components,
      ...snapshotRecordComponents.components,
      SyncRequest: syncRequestComponents.root,
      StudentOperation: studentOperationComponents.root,
      SyncEvent: syncEventComponents.root,
      SnapshotRecord: snapshotRecordComponents.root,
      IncrementalSyncResponse: withArrayItemReference(
        incrementalSyncResponseSchema,
        'events',
        'SyncEvent',
      ),
      AccountSnapshotResponse: withArrayItemReference(
        accountSnapshotResponseSchema,
        'records',
        'SnapshotRecord',
      ),
      ClassSectionSnapshotResponse: withArrayItemReference(
        classSectionSnapshotResponseSchema,
        'records',
        'SnapshotRecord',
      ),
      SyncResponse: {
        oneOf: [
          { $ref: '#/components/schemas/IncrementalSyncResponse' },
          { $ref: '#/components/schemas/AccountSnapshotResponse' },
          { $ref: '#/components/schemas/ClassSectionSnapshotResponse' },
        ],
        discriminator: {
          propertyName: 'mode',
          mapping: {
            incremental: '#/components/schemas/IncrementalSyncResponse',
            account_snapshot: '#/components/schemas/AccountSnapshotResponse',
            class_section_snapshot:
              '#/components/schemas/ClassSectionSnapshotResponse',
          },
        },
      },
      CatalogPlanBatchRequest: component(catalogPlanBatchRequestSchema),
      CatalogPlanBatchResponse: component(catalogPlanBatchResponseSchema),
      CatalogUploadResponse: component(catalogUploadResponseSchema),
      CatalogApplyAllRequest: component(catalogApplyAllRequestSchema),
      CatalogApplyResponse: component(catalogApplyResponseSchema),
      CatalogCancelRequest: component(catalogCancelRequestSchema),
      CatalogCancelResponse: component(catalogCancelResponseSchema),
      CatalogImportStatus: component(catalogImportStatusSchema),
      AdminBootstrapRequest: component(adminBootstrapRequestSchema),
      AdminReportResolutionRequest: component(
        adminReportResolutionRequestSchema,
      ),
      AdminContentActionRequest: component(adminContentActionRequestSchema),
      AdminUserActionRequest: component(adminUserActionRequestSchema),
      AdminRoleRequest: component(adminRoleRequestSchema),
      AdminTaskMergeRequest: component(adminTaskMergeRequestSchema),
      Health: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['live', 'ready'] } },
        additionalProperties: false,
      },
      GenericResult: { type: 'object', additionalProperties: true },
      GenericPage: { type: 'object', additionalProperties: true },
    },
  },
});

function addRateLimitResponses<
  Document extends { paths: Record<string, Record<string, unknown>> },
>(document: Document): Document {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (isProtectedOperation(operation)) {
        for (const [status, errorResponse] of Object.entries(
          protectedErrorResponses,
        )) {
          operation.responses[status] ??= errorResponse;
        }
        operation.responses['429'] ??= rateLimitedResponse;
      }
    }
  }
  return document;
}

function isProtectedOperation(value: unknown): value is {
  security: unknown;
  responses: Record<string, unknown>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'security' in value &&
    'responses' in value &&
    typeof value.responses === 'object' &&
    value.responses !== null
  );
}

function adminContentOperation(summary: string) {
  return {
    post: {
      tags: ['admin'],
      summary,
      security: bearer,
      parameters: [uuidParameter('content_id', 'Content UUIDv7.')],
      requestBody: requestBody('AdminContentActionRequest'),
      responses: { '200': response('Moderation result.', 'GenericResult') },
    },
  };
}

function adminUserOperation(summary: string) {
  return {
    post: {
      tags: ['admin'],
      summary,
      security: bearer,
      parameters: [uuidParameter('user_id', 'User UUIDv7.')],
      requestBody: requestBody('AdminUserActionRequest'),
      responses: { '200': response('User status result.', 'GenericResult') },
    },
  };
}
