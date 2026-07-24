import { z, type ZodType } from 'zod';

import {
  accountRegistrationRequestSchema,
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
  catalogImportStatusSchema,
  catalogPlanBatchRequestSchema,
  catalogPlanBatchResponseSchema,
  classSectionSnapshotResponseSchema,
  classSectionsResponseSchema,
  commentRevisionPageSchema,
  coursesResponseSchema,
  emailChallengeRequestSchema,
  emailChallengeResponseSchema,
  emailVerificationRequestSchema,
  incrementalSyncResponseSchema,
  profileUpdateRequestSchema,
  publicUserSchema,
  sessionSchema,
  syncRequestSchema,
  termsResponseSchema,
  verificationResponseSchema,
} from '@ddl-tracker/contracts';

function component(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-2020-12',
    unrepresentable: 'any',
  });
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

const bearer = [{ bearerAuth: [] }];
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

export const openApiDocument = addRateLimitResponses({
  openapi: '3.1.0',
  info: {
    title: 'DDL Tracker API',
    version: '1.0.0',
    description:
      'Passwordless course deadline tracking, offline synchronization, catalog administration, and moderation API.',
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
    '/v1/auth/email/challenges': {
      post: {
        tags: ['auth'],
        summary: 'Request an institutional email verification code',
        requestBody: requestBody('EmailChallengeRequest'),
        responses: {
          '200': response('Challenge created.', 'EmailChallengeResponse'),
          '400': response('Invalid email or request.', 'ApiError'),
          '429': response('Challenge rate limited.', 'ApiError'),
        },
      },
    },
    '/v1/auth/email/verifications': {
      post: {
        tags: ['auth'],
        summary: 'Verify an email code',
        requestBody: requestBody('EmailVerificationRequest'),
        responses: {
          '200': response('Verification completed.', 'VerificationResponse'),
          '400': response('Invalid or expired challenge.', 'ApiError'),
        },
      },
    },
    '/v1/accounts/registrations': {
      post: {
        tags: ['auth'],
        summary: 'Register an account after verification',
        requestBody: requestBody('AccountRegistrationRequest'),
        responses: {
          '201': response('Account registered.', 'SessionVerificationResponse'),
          '400': response('Invalid registration.', 'ApiError'),
          '409': response('Username conflict.', 'ApiError'),
        },
      },
    },
    '/v1/me': {
      get: {
        tags: ['auth'],
        summary: 'Read the current public profile',
        security: bearer,
        responses: {
          '200': response('Current user.', 'PublicUser'),
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
          '200': response('Updated user.', 'PublicUser'),
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
      EmailChallengeRequest: component(emailChallengeRequestSchema),
      EmailChallengeResponse: component(emailChallengeResponseSchema),
      EmailVerificationRequest: component(emailVerificationRequestSchema),
      VerificationResponse: component(verificationResponseSchema),
      AccountRegistrationRequest: component(accountRegistrationRequestSchema),
      SessionVerificationResponse: component(
        verificationResponseSchema.options[1],
      ),
      PublicUser: component(publicUserSchema),
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
      SyncRequest: component(syncRequestSchema),
      IncrementalSyncResponse: component(incrementalSyncResponseSchema),
      AccountSnapshotResponse: component(accountSnapshotResponseSchema),
      ClassSectionSnapshotResponse: component(classSectionSnapshotResponseSchema),
      SyncResponse: {
        oneOf: [
          { $ref: '#/components/schemas/IncrementalSyncResponse' },
          { $ref: '#/components/schemas/AccountSnapshotResponse' },
          { $ref: '#/components/schemas/ClassSectionSnapshotResponse' },
        ],
      },
      CatalogPlanBatchRequest: component(catalogPlanBatchRequestSchema),
      CatalogPlanBatchResponse: component(catalogPlanBatchResponseSchema),
      CatalogApplyAllRequest: component(catalogApplyAllRequestSchema),
      CatalogApplyResponse: component(catalogApplyResponseSchema),
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
