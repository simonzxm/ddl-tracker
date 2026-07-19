import { describe, expect, it } from 'vitest';

import { SnapshotTokenCodec } from '../src/sync/snapshot-token.js';

const USER_ID = '018f0000-0000-7000-8000-000000002501';
const SECTION_ID = '018f0000-0000-7000-8000-000000002502';
const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-07-19T12:00:00.000Z');

describe('SnapshotTokenCodec', () => {
  it('round-trips an account snapshot and page key', async () => {
    const codec = new SnapshotTokenCodec(SECRET, 'staging');
    const snapshot = await codec.createAccount(USER_ID, 42, NOW);
    const page = await codec.createPage(
      snapshot,
      { recordType: 'personal_todo', id: USER_ID },
      NOW,
    );

    await expect(codec.decodeSnapshot(snapshot, USER_ID, NOW)).resolves.toMatchObject({
      kind: 'account',
      anchorSequence: 42,
      classSectionId: null,
    });
    await expect(codec.decodePage(page, snapshot, USER_ID, NOW)).resolves.toEqual({
      recordType: 'personal_todo',
      id: USER_ID,
    });
  });

  it('round-trips a class section snapshot binding', async () => {
    const codec = new SnapshotTokenCodec(SECRET, 'staging');
    const token = await codec.createClassSection(USER_ID, SECTION_ID, 9, NOW);

    await expect(codec.decodeSnapshot(token, USER_ID, NOW)).resolves.toMatchObject({
      kind: 'class_section',
      classSectionId: SECTION_ID,
      anchorSequence: 9,
    });
  });

  it('rejects expired, cross-user, cross-environment, and mismatched page tokens', async () => {
    const codec = new SnapshotTokenCodec(SECRET, 'staging');
    const account = await codec.createAccount(USER_ID, 1, NOW);
    const section = await codec.createClassSection(USER_ID, SECTION_ID, 1, NOW);
    const page = await codec.createPage(
      account,
      { recordType: 'user_profile', id: USER_ID },
      NOW,
    );

    await expect(
      codec.decodeSnapshot(
        account,
        USER_ID,
        new Date(NOW.getTime() + 16 * 60 * 1000),
      ),
    ).rejects.toThrow('expired');
    await expect(
      codec.decodeSnapshot(
        account,
        '018f0000-0000-7000-8000-000000002599',
        NOW,
      ),
    ).rejects.toThrow('binding');
    await expect(
      new SnapshotTokenCodec(SECRET, 'production').decodeSnapshot(
        account,
        USER_ID,
        NOW,
      ),
    ).rejects.toThrow('binding');
    await expect(codec.decodePage(page, section, USER_ID, NOW)).rejects.toThrow(
      'snapshot',
    );
  });

  it('renews inactivity expiry without changing the anchor', async () => {
    const codec = new SnapshotTokenCodec(SECRET, 'staging');
    const original = await codec.createAccount(USER_ID, 42, NOW);
    const renewedAt = new Date(NOW.getTime() + 10 * 60 * 1000);
    const renewed = await codec.renew(original, USER_ID, renewedAt);

    await expect(
      codec.decodeSnapshot(
        renewed,
        USER_ID,
        new Date(NOW.getTime() + 20 * 60 * 1000),
      ),
    ).resolves.toMatchObject({ anchorSequence: 42 });
  });
});
