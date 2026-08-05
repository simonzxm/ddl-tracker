import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import {
  adminAuditPageSchema,
  adminBootstrapResponseSchema,
  adminContentActionResponseSchema,
  adminReportPageSchema,
  adminReportResolutionResponseSchema,
  adminRoleResponseSchema,
  adminTaskMergeResponseSchema,
  adminUserActionResponseSchema,
  apiErrorSchema,
  catalogApplyResponseSchema,
  catalogCancelResponseSchema,
  catalogImportStatusSchema,
  catalogPlanBatchResponseSchema,
  catalogUploadResponseSchema,
  classSectionsResponseSchema,
  commentRevisionPageSchema,
  coursesResponseSchema,
  currentUserSchema,
  healthResponseSchema,
  oidcAuthorizationResponseSchema,
  sessionListResponseSchema,
  sessionVerificationResponseSchema,
  syncResponseSchema,
  termsResponseSchema,
} from '../src/index.js';

const ID = '018f0000-0000-7000-8000-000000000001';
const OTHER_ID = '018f0000-0000-7000-8000-000000000002';
const TIMESTAMP = '2026-08-05T07:00:00.000Z';
const HASH = 'a'.repeat(64);

const currentUser = {
  id: ID,
  username: 'student_123',
  display_name: 'Student',
  avatar_url: null,
  bio: null,
  status: 'active' as const,
  profile_revision: 1,
  roles: [] as const,
};

const session = {
  id: ID,
  device_name: 'MacBook',
  device_metadata: { platform: 'macos' },
  created_at: TIMESTAMP,
  last_seen_at: TIMESTAMP,
  idle_expires_at: TIMESTAMP,
  absolute_expires_at: TIMESTAMP,
  revoked_at: null,
};

const emptyDiff = {
  terms: { added: 0, updated: 0, unchanged: 0, deactivated: 0 },
  courses: { added: 0, updated: 0, unchanged: 0, deactivated: 1 },
  class_sections: { added: 0, updated: 0, unchanged: 0, deactivated: 1 },
  field_changes: {},
  deactivated_courses: [
    { id: ID, external_course_code: 'COURSE-1' },
  ],
  deactivated_class_sections: [
    { id: OTHER_ID, external_section_id: 'SECTION-1' },
  ],
  deactivated_class_section_ids: [OTHER_ID],
  checksum_previously_applied: false,
};

interface ResponseContractCase {
  name: string;
  schema: ZodType;
  value: Record<string, unknown>;
  requiredKey: string;
}

const responseContracts: ResponseContractCase[] = [
  {
    name: 'health',
    schema: healthResponseSchema,
    value: { status: 'live' },
    requiredKey: 'status',
  },
  {
    name: 'OIDC authorization start',
    schema: oidcAuthorizationResponseSchema,
    value: {
      authorization_url: 'https://issuer.example/authorize',
      expires_at: TIMESTAMP,
    },
    requiredKey: 'authorization_url',
  },
  {
    name: 'OIDC session exchange',
    schema: sessionVerificationResponseSchema,
    value: {
      kind: 'session',
      access_token: 'opaque-token',
      token_type: 'Bearer',
      expires_at: TIMESTAMP,
      user: currentUser,
    },
    requiredKey: 'user',
  },
  {
    name: 'current user',
    schema: currentUserSchema,
    value: currentUser,
    requiredKey: 'roles',
  },
  {
    name: 'session list',
    schema: sessionListResponseSchema,
    value: { sessions: [session] },
    requiredKey: 'sessions',
  },
  {
    name: 'term list',
    schema: termsResponseSchema,
    value: {
      terms: [
        {
          id: ID,
          external_code: '2026-2027-1',
          name: 'Term',
          starts_on: '2026-08-31',
          ends_on: '2027-01-17',
          status: 'upcoming',
        },
      ],
    },
    requiredKey: 'terms',
  },
  {
    name: 'course list',
    schema: coursesResponseSchema,
    value: {
      courses: [
        {
          id: ID,
          external_course_code: '001',
          name: 'Course',
          credits: '3.00',
        },
      ],
    },
    requiredKey: 'courses',
  },
  {
    name: 'class section list',
    schema: classSectionsResponseSchema,
    value: {
      class_sections: [
        {
          id: ID,
          external_section_id: 'section-1',
          section_number: '01',
          department_code: null,
          department_name: null,
          instructors: ['Teacher'],
          campus: null,
          capacity: 100,
          schedule_text: null,
          active: true,
          revision: 1,
        },
      ],
    },
    requiredKey: 'class_sections',
  },
  {
    name: 'comment revision page',
    schema: commentRevisionPageSchema,
    value: {
      comment_id: ID,
      revisions: [
        {
          revision: 1,
          body: 'Comment body',
          author_id: OTHER_ID,
          created_at: TIMESTAMP,
        },
      ],
      next_after_revision: null,
    },
    requiredKey: 'comment_id',
  },
  {
    name: 'incremental sync',
    schema: syncResponseSchema,
    value: {
      protocol_version: 2,
      mode: 'incremental',
      request_id: ID,
      operation_results: [],
      events: [],
      next_cursor: 'cursor',
      has_more: false,
    },
    requiredKey: 'next_cursor',
  },
  {
    name: 'account snapshot sync',
    schema: syncResponseSchema,
    value: {
      protocol_version: 2,
      mode: 'account_snapshot',
      request_id: ID,
      records: [],
      snapshot_token: 'snapshot',
      next_page_token: null,
      snapshot_complete: true,
      next_cursor: 'cursor',
    },
    requiredKey: 'snapshot_token',
  },
  {
    name: 'class section snapshot sync',
    schema: syncResponseSchema,
    value: {
      protocol_version: 2,
      mode: 'class_section_snapshot',
      class_section_id: ID,
      request_id: OTHER_ID,
      records: [],
      snapshot_token: 'snapshot',
      next_page_token: null,
      snapshot_complete: true,
      resume_cursor: 'cursor',
    },
    requiredKey: 'class_section_id',
  },
  {
    name: 'catalog plan',
    schema: catalogPlanBatchResponseSchema,
    value: {
      import_id: ID,
      batch_index: 0,
      accepted: true,
      received_batches: 1,
      total_batches: 1,
      plan_complete: true,
      diff: emptyDiff,
    },
    requiredKey: 'import_id',
  },
  {
    name: 'catalog upload',
    schema: catalogUploadResponseSchema,
    value: {
      import_id: ID,
      replayed: false,
      filename: 'catalog.csv.gz',
      checksum: HASH,
      manifest_hash: HASH,
      row_count: 1,
      course_count: 1,
      class_section_count: 1,
      total_batches: 1,
      warnings: [],
      diff: emptyDiff,
    },
    requiredKey: 'filename',
  },
  {
    name: 'catalog apply',
    schema: catalogApplyResponseSchema,
    value: {
      import_id: ID,
      replayed: false,
      applied_batches: 1,
      total_batches: 1,
      complete: true,
    },
    requiredKey: 'complete',
  },
  {
    name: 'catalog cancellation',
    schema: catalogCancelResponseSchema,
    value: { import_id: ID, status: 'cancelled', replayed: false },
    requiredKey: 'status',
  },
  {
    name: 'catalog import status',
    schema: catalogImportStatusSchema,
    value: {
      import_id: ID,
      status: 'planned',
      received_batches: 1,
      applied_batches: 0,
      total_batches: 1,
      diff: null,
      failure_message: null,
    },
    requiredKey: 'status',
  },
  {
    name: 'admin bootstrap',
    schema: adminBootstrapResponseSchema,
    value: { maintainer: true },
    requiredKey: 'maintainer',
  },
  {
    name: 'admin content action',
    schema: adminContentActionResponseSchema,
    value: { state: 'hidden', revision: 2, changed: true },
    requiredKey: 'revision',
  },
  {
    name: 'admin report page',
    schema: adminReportPageSchema,
    value: {
      reports: [
        {
          id: ID,
          reporter_id: OTHER_ID,
          target_type: 'comment',
          target_id: ID,
          reason: 'other',
          details: 'Needs review.',
          status: 'open',
          resolution: null,
          resolved_by: null,
          created_at: TIMESTAMP,
          resolved_at: null,
        },
      ],
      next: null,
    },
    requiredKey: 'reports',
  },
  {
    name: 'admin report resolution',
    schema: adminReportResolutionResponseSchema,
    value: { status: 'resolved' },
    requiredKey: 'status',
  },
  {
    name: 'admin user action',
    schema: adminUserActionResponseSchema,
    value: { status: 'suspended', changed: true },
    requiredKey: 'changed',
  },
  {
    name: 'admin role action',
    schema: adminRoleResponseSchema,
    value: { maintainer: true, changed: true },
    requiredKey: 'changed',
  },
  {
    name: 'admin task merge',
    schema: adminTaskMergeResponseSchema,
    value: {
      source_task_id: ID,
      target_task_id: OTHER_ID,
      redirected_proposals: 0,
      moved_proposals: 1,
      recovered_personal_todos: 0,
    },
    requiredKey: 'target_task_id',
  },
  {
    name: 'admin audit page',
    schema: adminAuditPageSchema,
    value: {
      entries: [
        {
          id: ID,
          actor_id: OTHER_ID,
          action: 'Legacy action v1',
          target_type: 'Imported object',
          target_id: ID,
          reason: 'Reviewed.',
          result: { state: 'hidden' },
          request_id: OTHER_ID,
          created_at: TIMESTAMP,
        },
      ],
      next: null,
    },
    requiredKey: 'entries',
  },
  {
    name: 'API error',
    schema: apiErrorSchema,
    value: {
      code: 'invalid_request',
      details: {},
      message: 'Invalid request.',
      retryable: false,
      request_id: ID,
    },
    requiredKey: 'request_id',
  },
];

type JsonPath = (string | number)[];

interface ResponseMutation {
  label: string;
  value: Record<string, unknown>;
}

const openMapKeys = new Set([
  'details',
  'device_metadata',
  'field_changes',
  'result',
]);

function mutateAtPath(
  value: Record<string, unknown>,
  path: JsonPath,
  mutate: (target: Record<string, unknown>) => void,
): Record<string, unknown> {
  const copy = structuredClone(value);
  let target: unknown = copy;
  for (const segment of path) {
    target = Array.isArray(target)
      ? target[segment as number]
      : (target as Record<string, unknown>)[segment as string];
  }
  mutate(target as Record<string, unknown>);
  return copy;
}

function strictObjectMutations(
  value: Record<string, unknown>,
): ResponseMutation[] {
  const mutations: ResponseMutation[] = [];

  function visit(current: unknown, path: JsonPath): void {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (typeof current !== 'object' || current === null) return;

    const object = current as Record<string, unknown>;
    mutations.push({
      label: `${path.join('.') || '<root>'} rejects an added field`,
      value: mutateAtPath(value, path, (target) => {
        target['unexpected_response_field'] = true;
      }),
    });

    for (const [key, child] of Object.entries(object)) {
      mutations.push({
        label: `${[...path, key].join('.')} is required`,
        value: mutateAtPath(value, path, (target) => {
          Reflect.deleteProperty(target, key);
        }),
      });
      if (!openMapKeys.has(key)) visit(child, [...path, key]);
    }
  }

  visit(value, []);
  return mutations;
}

describe('public HTTP response contracts', () => {
  for (const contract of responseContracts) {
    it(`${contract.name} rejects added and missing top-level fields`, () => {
      expect(contract.schema.safeParse(contract.value).success).toBe(true);
      expect(
        contract.schema.safeParse({
          ...contract.value,
          unexpected_response_field: true,
        }).success,
      ).toBe(false);

      const missing = { ...contract.value };
      Reflect.deleteProperty(missing, contract.requiredKey);
      expect(contract.schema.safeParse(missing).success).toBe(false);
    });

    it(`${contract.name} is exact at every represented object level`, () => {
      for (const mutation of strictObjectMutations(contract.value)) {
        expect(
          contract.schema.safeParse(mutation.value).success,
          mutation.label,
        ).toBe(false);
      }
    });
  }
});
