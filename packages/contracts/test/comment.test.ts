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

  it('preserves historical stored text outside current mutation limits', () => {
    const page = commentRevisionPageSchema.parse({
      comment_id: COMMENT_ID,
      revisions: [
        {
          revision: 1,
          body: '',
          author_id: AUTHOR_ID,
          created_at: '2026-07-19T12:00:00.000Z',
        },
        {
          revision: 2,
          body: 'C'.repeat(4_001),
          author_id: AUTHOR_ID,
          created_at: '2026-07-19T13:00:00.000Z',
        },
      ],
      next_after_revision: null,
    });

    expect(page.revisions[0]?.body).toBe('');
    expect(page.revisions[1]?.body).toHaveLength(4_001);
  });

  it('rejects invalid revision metadata', () => {
    expect(() =>
      commentRevisionPageSchema.parse({
        comment_id: COMMENT_ID,
        revisions: [
          {
            revision: 0,
            body: 'Stored body',
            author_id: AUTHOR_ID,
            created_at: 'not-a-time',
          },
        ],
        next_after_revision: null,
      }),
    ).toThrow();
  });
});
