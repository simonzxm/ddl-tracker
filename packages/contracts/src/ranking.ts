import { ContractValidationError } from './validation.js';

export const WILSON_RANKING_VERSION = 1;
export const WILSON_Z = 1.96;

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
