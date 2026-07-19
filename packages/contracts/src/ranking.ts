import { parseUuidV7 } from './uuid.js';
import {
  canonicalizeTimestamp,
  ContractValidationError,
} from './validation.js';

export const WILSON_RANKING_VERSION = 1;
export const WILSON_Z = 1.96;

export interface ProposalRankingInput {
  id: string;
  up: number;
  down: number;
  created_at: string;
}

export interface RankedProposal extends ProposalRankingInput {
  score: number;
}

export type ProposalConfidence =
  | 'pending_verification'
  | 'disputed'
  | 'supported';

function validateVoteCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContractValidationError(
      `${field} must be a non-negative safe integer.`,
    );
  }
}

export function wilsonScore(
  up: number,
  down: number,
  z = WILSON_Z,
): number {
  validateVoteCount(up, 'Up votes');
  validateVoteCount(down, 'Down votes');
  if (!Number.isFinite(z) || z <= 0) {
    throw new ContractValidationError('Wilson z must be positive.');
  }

  const total = up + down;
  if (total === 0) {
    return 0;
  }

  const proportion = up / total;
  const zSquared = z * z;
  const numerator =
    proportion +
    zSquared / (2 * total) -
    z *
      Math.sqrt(
        (proportion * (1 - proportion) + zSquared / (4 * total)) / total,
      );
  const denominator = 1 + zSquared / total;

  return Math.max(0, numerator / denominator);
}

export function rankProposals(
  proposals: readonly ProposalRankingInput[],
): RankedProposal[] {
  return proposals
    .map((proposal) => ({
      id: parseUuidV7(proposal.id),
      up: proposal.up,
      down: proposal.down,
      created_at: canonicalizeTimestamp(proposal.created_at),
      score: wilsonScore(proposal.up, proposal.down),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      const totalDifference = right.up + right.down - (left.up + left.down);
      if (totalDifference !== 0) {
        return totalDifference;
      }

      const creationOrder = left.created_at.localeCompare(right.created_at);
      if (creationOrder !== 0) {
        return creationOrder;
      }

      return left.id.localeCompare(right.id);
    });
}

export function classifyProposalConfidence(
  leader: RankedProposal,
  runnerUp: RankedProposal | undefined,
): ProposalConfidence {
  const total = leader.up + leader.down;
  if (total < 3) {
    return 'pending_verification';
  }

  if (leader.down * 3 >= total) {
    return 'disputed';
  }

  if (
    runnerUp !== undefined &&
    runnerUp.score > leader.score - 0.05
  ) {
    return 'disputed';
  }

  return 'supported';
}
