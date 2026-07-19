import { describe, expect, it } from 'vitest';
import {
  canonicalizeProposal,
  fingerprintProposal,
} from '../src/proposal.js';

describe('proposal canonicalization', () => {
  it('normalizes every field used by exact duplicate detection', async () => {
    const first = canonicalizeProposal({
      title: '  Cafe\u0301 homework  ',
      deadline: '2026-09-01T08:30:00+08:00',
      description: 'line one\r\nline two',
      evidence_note: '  LMS announcement ',
      evidence_url: 'HTTPS://Example.COM:443/tasks/1#details',
    });
    const second = canonicalizeProposal({
      title: 'Café homework',
      deadline: '2026-09-01T00:30:00Z',
      description: 'line one\nline two',
      evidence_note: 'LMS announcement',
      evidence_url: 'https://example.com/tasks/1',
    });

    expect(first).toEqual({
      title: 'Café homework',
      deadline: '2026-09-01T00:30:00.000Z',
      description: 'line one\nline two',
      evidence_note: 'LMS announcement',
      evidence_url: 'https://example.com/tasks/1',
    });
    await expect(fingerprintProposal(first)).resolves.toBe(
      await fingerprintProposal(second),
    );
  });

  it('uses stable nulls and keeps semantically different titles distinct', async () => {
    const homework = canonicalizeProposal({
      title: 'Homework 3',
      deadline: '2026-09-01T00:30:00Z',
    });
    const shortTitle = canonicalizeProposal({
      title: 'HW3',
      deadline: '2026-09-01T00:30:00Z',
      description: '   ',
    });

    expect(shortTitle.description).toBeNull();
    expect(await fingerprintProposal(homework)).not.toBe(
      await fingerprintProposal(shortTitle),
    );
  });

  it('enforces documented field limits after normalization', () => {
    expect(() =>
      canonicalizeProposal({
        title: '   ',
        deadline: '2026-09-01T00:30:00Z',
      }),
    ).toThrow();
    expect(() =>
      canonicalizeProposal({
        title: 'x'.repeat(201),
        deadline: '2026-09-01T00:30:00Z',
      }),
    ).toThrow();
  });
});
