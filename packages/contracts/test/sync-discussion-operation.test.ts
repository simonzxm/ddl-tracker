import { describe, expect, it } from 'vitest';
import { discussionOperationSchema } from '../src/sync/discussion-operation.js';

const OPERATION_ID = '018f0000-0000-7000-8000-000000000001';
const TASK_ID = '018f0000-0000-7000-8000-000000000010';
const COMMENT_ID = '018f0000-0000-7000-8000-000000000011';
const REPORT_ID = '018f0000-0000-7000-8000-000000000012';

function envelope(type: string, payload: Record<string, unknown>) {
  return {
    operation_id: OPERATION_ID,
    type,
    schema_version: 1,
    depends_on: [],
    payload,
  };
}

describe('comment revision payloads', () => {
  it('normalizes create and edit bodies while requiring edit revisions', () => {
    expect(
      discussionOperationSchema.parse(
        envelope('create_task_comment', {
          comment_id: COMMENT_ID,
          course_task_id: TASK_ID,
          body: '  Check page 3\r\nfor the rubric. ',
        }),
      ).payload,
    ).toEqual({
      comment_id: COMMENT_ID,
      course_task_id: TASK_ID,
      body: 'Check page 3\nfor the rubric.',
    });

    expect(() =>
      discussionOperationSchema.parse(
        envelope('edit_task_comment', {
          comment_id: COMMENT_ID,
          body: 'Updated',
        }),
      ),
    ).toThrow();
  });

  it('uses expected revision for comment deletion', () => {
    expect(
      discussionOperationSchema.parse(
        envelope('delete_task_comment', {
          comment_id: COMMENT_ID,
          expected_revision: 3,
        }),
      ).payload,
    ).toEqual({ comment_id: COMMENT_ID, expected_revision: 3 });
  });
});

describe('private content report payloads', () => {
  it('accepts a bounded normalized report without reporter identity', () => {
    expect(
      discussionOperationSchema.parse(
        envelope('create_content_report', {
          report_id: REPORT_ID,
          target_type: 'proposal',
          target_id: TASK_ID,
          reason: 'inaccurate',
          details: '  Wrong semester ',
        }),
      ).payload,
    ).toEqual({
      report_id: REPORT_ID,
      target_type: 'proposal',
      target_id: TASK_ID,
      reason: 'inaccurate',
      details: 'Wrong semester',
    });
  });

  it('rejects unknown targets, reasons, and client-supplied reporter IDs', () => {
    expect(() =>
      discussionOperationSchema.parse(
        envelope('create_content_report', {
          report_id: REPORT_ID,
          target_type: 'database',
          target_id: TASK_ID,
          reason: 'other',
          details: null,
        }),
      ),
    ).toThrow();
    expect(() =>
      discussionOperationSchema.parse(
        envelope('create_content_report', {
          report_id: REPORT_ID,
          target_type: 'comment',
          target_id: TASK_ID,
          reason: 'abuse',
          details: null,
          reporter_id: TASK_ID,
        }),
      ),
    ).toThrow();
  });
});
