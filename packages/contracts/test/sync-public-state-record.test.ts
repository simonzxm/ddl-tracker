import { describe, expect, it } from 'vitest';

import {
  accuracyVoteRecordSchema,
  contentTombstoneSchema,
  proposalRedirectRecordSchema,
  proposalVoteTotalsRecordSchema,
  publicUserProfileRecordSchema,
  taskCommentRecordSchema,
  taskMergeRecordSchema,
} from '../src/sync/public-record.js';

const USER_ID = '018f0000-0000-7000-8000-000000000001';
const TASK_ID = '018f0000-0000-7000-8000-000000000002';
const PROPOSAL_ID = '018f0000-0000-7000-8000-000000000003';
const OTHER_ID = '018f0000-0000-7000-8000-000000000004';
const COMMENT_ID = '018f0000-0000-7000-8000-000000000005';
const NOW = '2026-09-01T00:30:00Z';

describe('public sync state records', () => {
  it('parses public profiles, aggregates, and current votes', () => {
    expect(
      publicUserProfileRecordSchema.parse({
        id: USER_ID,
        username: 'student_1',
        display_name: 'Student One',
        avatar_url: null,
        bio: null,
        status: 'active',
        revision: 2,
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ id: USER_ID, revision: 2 });

    expect(
      proposalVoteTotalsRecordSchema.parse({
        proposal_id: PROPOSAL_ID,
        up: 4,
        down: 1,
        revision: 3,
        updated_at: NOW,
      }),
    ).toEqual({
      proposal_id: PROPOSAL_ID,
      up: 4,
      down: 1,
      revision: 3,
      updated_at: '2026-09-01T00:30:00.000Z',
    });

    expect(
      accuracyVoteRecordSchema.parse({
        proposal_id: PROPOSAL_ID,
        value: 'none',
        revision: 4,
        updated_at: NOW,
      }),
    ).toMatchObject({ value: 'none', revision: 4 });
  });

  it('parses comments, redirects, and task merges', () => {
    expect(
      taskCommentRecordSchema.parse({
        id: COMMENT_ID,
        course_task_id: TASK_ID,
        author_id: USER_ID,
        body: 'The deadline was announced in class.',
        revision: 2,
        state: 'visible',
        deleted_at: null,
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ id: COMMENT_ID, revision: 2 });

    expect(
      proposalRedirectRecordSchema.parse({
        source_proposal_id: PROPOSAL_ID,
        canonical_proposal_id: OTHER_ID,
        revision: 2,
        created_at: NOW,
      }),
    ).toMatchObject({ source_proposal_id: PROPOSAL_ID });

    expect(
      taskMergeRecordSchema.parse({
        source_task_id: TASK_ID,
        target_task_id: OTHER_ID,
        reason: 'Duplicate course task.',
        revision: 2,
        created_at: NOW,
      }),
    ).toMatchObject({ target_task_id: OTHER_ID });
  });

  it('uses a nested discriminator for content tombstones', () => {
    expect(
      contentTombstoneSchema.parse({
        entity_type: 'task_comment',
        entity_id: COMMENT_ID,
        state: 'deleted',
        revision: 3,
        deleted_at: NOW,
      }),
    ).toMatchObject({ entity_type: 'task_comment', state: 'deleted' });

    expect(() =>
      contentTombstoneSchema.parse({
        entity_type: 'task_proposal',
        entity_id: PROPOSAL_ID,
        state: 'deleted',
        revision: 3,
        deleted_at: NOW,
      }),
    ).toThrow();
  });
});
