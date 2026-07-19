import { describe, expect, it } from 'vitest';

import {
  adminBootstrapRequestSchema,
  adminContentActionRequestSchema,
  adminReportResolutionRequestSchema,
  adminRoleRequestSchema,
  adminTaskMergeRequestSchema,
  adminUserActionRequestSchema,
} from '../src/admin.js';

const TARGET_ID = '018f0000-0000-7000-8000-000000003101';

describe('maintainer contracts', () => {
  it('validates all management mutation payloads', () => {
    expect(
      adminBootstrapRequestSchema.parse({ bootstrap_token: 'secret-token' }),
    ).toEqual({ bootstrap_token: 'secret-token' });
    expect(
      adminReportResolutionRequestSchema.parse({
        status: 'resolved',
        resolution: 'Reviewed and hidden.',
      }),
    ).toMatchObject({ status: 'resolved' });
    expect(
      adminContentActionRequestSchema.parse({
        target_type: 'proposal',
        reason: 'Contains inaccurate public information.',
      }),
    ).toMatchObject({ target_type: 'proposal' });
    expect(
      adminUserActionRequestSchema.parse({ reason: 'Repeated abuse.' }),
    ).toEqual({ reason: 'Repeated abuse.' });
    expect(
      adminRoleRequestSchema.parse({
        maintainer: true,
        reason: 'On-call maintainer rotation.',
      }),
    ).toMatchObject({ maintainer: true });
    expect(
      adminTaskMergeRequestSchema.parse({
        target_task_id: TARGET_ID,
        reason: 'Confirmed duplicate.',
      }),
    ).toMatchObject({ target_task_id: TARGET_ID });
  });

  it('rejects unknown targets and empty reasons', () => {
    expect(() =>
      adminContentActionRequestSchema.parse({
        target_type: 'vote',
        reason: '',
      }),
    ).toThrow();
    expect(() =>
      adminRoleRequestSchema.parse({ maintainer: false, reason: ' ' }),
    ).toThrow();
  });
});
