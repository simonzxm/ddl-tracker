import { describe, expect, it } from 'vitest';

import { commentRevisionPageSchema } from '../src/comment.js';

const COMMENT_ID = '018f0000-0000-7000-8000-000000002801';
const AUTHOR_ID = '018f0000-0000-7000-8000-000000002802';

describe('comment revision history contract', () => {
  it('accepts a chronological page with a continuation revision', () => {
    expect(
      commentRevisionPageSchema.parse({
        comment_id: COMMENT_ID,
        revisions: [
          {
            revision: 1,
            body: 'Initial',
            author_id: AUTHOR_ID,
            created_at: '2026-07-19T12:00:00.000Z',
          },
        ],
        next_after_revision: 1,
      }),
    ).toMatchObject({ comment_id: COMMENT_ID, next_after_revision: 1 });
  });

  it('rejects empty or noncanonical revision content', () => {
    expect(() =>
      commentRevisionPageSchema.parse({
        comment_id: COMMENT_ID,
        revisions: [
          {
            revision: 0,
            body: '',
            author_id: AUTHOR_ID,
            created_at: 'not-a-time',
          },
        ],
        next_after_revision: null,
      }),
    ).toThrow();
  });
});
