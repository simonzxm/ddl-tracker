import {
  canonicalizeEvidenceUrl,
  canonicalizeTimestamp,
  ContractValidationError,
  countUnicodeScalars,
  normalizePlainText,
} from './validation.js';

export interface ProposalInput {
  title: string;
  deadline: string;
  description?: string | null;
  evidence_note?: string | null;
  evidence_url?: string | null;
}

export interface CanonicalProposal {
  title: string;
  deadline: string;
  description: string | null;
  evidence_note: string | null;
  evidence_url: string | null;
}

function requiredText(value: string, field: string, maximum: number): string {
  const normalized = normalizePlainText(value);
  const length = countUnicodeScalars(normalized);
  if (length < 1 || length > maximum) {
    throw new ContractValidationError(
      `${field} must contain 1-${String(maximum)} Unicode scalar values.`,
    );
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  field: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = normalizePlainText(value);
  if (normalized === '') {
    return null;
  }
  if (countUnicodeScalars(normalized) > maximum) {
    throw new ContractValidationError(
      `${field} must contain at most ${String(maximum)} Unicode scalar values.`,
    );
  }
  return normalized;
}

function optionalUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }

  return canonicalizeEvidenceUrl(value);
}

export function canonicalizeProposal(input: ProposalInput): CanonicalProposal {
  return {
    title: requiredText(input.title, 'Title', 200),
    deadline: canonicalizeTimestamp(input.deadline),
    description: optionalText(input.description, 'Description', 2000),
    evidence_note: optionalText(input.evidence_note, 'Evidence note', 500),
    evidence_url: optionalUrl(input.evidence_url),
  };
}

export async function fingerprintProposal(
  proposal: CanonicalProposal,
): Promise<string> {
  const serialized = JSON.stringify(proposal);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialized),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
