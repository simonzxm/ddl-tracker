import { describe, expect, it } from 'vitest';
import { contributionOperationSchema } from '../src/sync/contribution-operation.js';

const OPERATION_ID = '018f0000-0000-7000-8000-000000000001';
const TASK_ID = '018f0000-0000-7000-8000-000000000010';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000000011';
const SECTION_ID = '018f0000-0000-7000-8000-000000000012';

function envelope(type: string, payload: Record<string, unknown>) {
  return {
    operation_id: OPERATION_ID,
    type,
    schema_version: 1,
    depends_on: [],
    payload,
  };
}

const proposal = {
  title: '  Assignment 1 ',
  deadline: '2026-09-01T08:30:00+08:00',
  description: null,
  evidence_note: ' LMS ',
  evidence_url: 'https://example.com/a#details',
};

describe('task and proposal contribution payloads', () => {
  it('canonicalizes an atomic task plus initial proposal create', () => {
    const parsed = contributionOperationSchema.parse(
      envelope('create_course_task_with_initial_proposal', {
        course_task_id: TASK_ID,
        class_section_id: SECTION_ID,
        proposal_id: PROPOSAL_ID,
        proposal,
      }),
    );

    if (parsed.type !== 'create_course_task_with_initial_proposal') {
      throw new Error('Unexpected contribution operation type.');
    }

    expect(parsed.payload.proposal).toEqual({
      title: 'Assignment 1',
      deadline: '2026-09-01T00:30:00.000Z',
      description: null,
      evidence_note: 'LMS',
      evidence_url: 'https://example.com/a',
    });
  });

  it('requires immutable proposal IDs and complete canonical fields', () => {
    expect(() =>
      contributionOperationSchema.parse(
        envelope('create_task_proposal', {
          course_task_id: TASK_ID,
          proposal,
        }),
      ),
    ).toThrow();
    expect(() =>
      contributionOperationSchema.parse(
        envelope('create_task_proposal', {
          course_task_id: TASK_ID,
          proposal_id: PROPOSAL_ID,
          proposal: { ...proposal, hidden: true },
        }),
      ),
    ).toThrow();
  });

  it('supports setting, changing, and withdrawing one accuracy vote', () => {
    for (const value of ['up', 'down', 'none'] as const) {
      expect(
        contributionOperationSchema.parse(
          envelope('set_accuracy_vote', {
            proposal_id: PROPOSAL_ID,
            value,
          }),
        ).payload,
      ).toEqual({ proposal_id: PROPOSAL_ID, value });
    }
  });

  it('publishes private records only through explicit full proposal payloads', () => {
    expect(
      contributionOperationSchema.parse(
        envelope('publish_personal_task_details_as_proposal', {
          course_task_id: TASK_ID,
          proposal_id: PROPOSAL_ID,
          expected_details_revision: 2,
          proposal,
        }),
      ).payload,
    ).toMatchObject({ expected_details_revision: 2 });
    expect(() =>
      contributionOperationSchema.parse(
        envelope('publish_personal_todo_as_course_task', {
          personal_todo_id: TASK_ID,
          expected_personal_todo_revision: 1,
          course_task_id: TASK_ID,
          class_section_id: SECTION_ID,
          proposal_id: PROPOSAL_ID,
        }),
      ),
    ).toThrow();
  });
});
