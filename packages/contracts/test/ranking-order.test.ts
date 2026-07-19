import { describe, expect, it } from 'vitest';
import {
  classifyProposalConfidence,
  rankProposals,
  type RankedProposal,
} from '../src/ranking.js';

const BASE_ID = '018f0000-0000-7000-8000-000000000000';

function ranked(
  overrides: Partial<RankedProposal> = {},
): RankedProposal {
  return {
    id: BASE_ID,
    up: 3,
    down: 0,
    created_at: '2026-07-19T00:00:00.000Z',
    score: 0.5,
    ...overrides,
  };
}

describe('proposal ranking order', () => {
  it('sorts by score, total votes, creation time, then UUID', () => {
    const candidates = [
      {
        id: '018f0000-0000-7000-8000-000000000004',
        up: 4,
        down: 0,
        created_at: '2026-07-19T00:00:00.000Z',
      },
      {
        id: '018f0000-0000-7000-8000-000000000003',
        up: 3,
        down: 0,
        created_at: '2026-07-18T00:00:00.000Z',
      },
      {
        id: '018f0000-0000-7000-8000-000000000002',
        up: 3,
        down: 0,
        created_at: '2026-07-18T00:00:00.000Z',
      },
      {
        id: '018f0000-0000-7000-8000-000000000001',
        up: 2,
        down: 0,
        created_at: '2026-07-17T00:00:00.000Z',
      },
      {
        id: '018f0000-0000-7000-8000-000000000006',
        up: 0,
        down: 1,
        created_at: '2026-07-16T00:00:00.000Z',
      },
      {
        id: '018f0000-0000-7000-8000-000000000005',
        up: 0,
        down: 2,
        created_at: '2026-07-19T00:00:00.000Z',
      },
    ];

    expect(rankProposals(candidates).map(({ id }) => id)).toEqual([
      '018f0000-0000-7000-8000-000000000004',
      '018f0000-0000-7000-8000-000000000002',
      '018f0000-0000-7000-8000-000000000003',
      '018f0000-0000-7000-8000-000000000001',
      '018f0000-0000-7000-8000-000000000005',
      '018f0000-0000-7000-8000-000000000006',
    ]);
  });
});

describe('proposal confidence', () => {
  it('is pending below three total votes', () => {
    expect(
      classifyProposalConfidence(ranked({ up: 2, down: 0 }), undefined),
    ).toBe('pending_verification');
  });

  it('is disputed when down votes are exactly one third', () => {
    expect(
      classifyProposalConfidence(ranked({ up: 2, down: 1 }), undefined),
    ).toBe('disputed');
  });

  it('is disputed only when the second-place gap is below 0.05', () => {
    const leader = ranked({ up: 3, down: 0, score: 0.5 });

    expect(
      classifyProposalConfidence(
        leader,
        ranked({ id: '018f0000-0000-7000-8000-000000000001', score: 0.451 }),
      ),
    ).toBe('disputed');
    expect(
      classifyProposalConfidence(
        leader,
        ranked({ id: '018f0000-0000-7000-8000-000000000001', score: 0.45 }),
      ),
    ).toBe('supported');
  });

  it('does not apply the score-gap rule when there is no runner-up', () => {
    expect(
      classifyProposalConfidence(ranked({ up: 3, down: 0 }), undefined),
    ).toBe('supported');
  });
});
