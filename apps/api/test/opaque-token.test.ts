import { describe, expect, it } from 'vitest';
import {
  signOpaqueToken,
  verifyOpaqueToken,
} from '../src/lib/opaque-token.js';

const USER_ID = '018f0000-0000-7000-8000-000000000001';
const KEY = '0123456789abcdef0123456789abcdef';

const payload = {
  version: 1 as const,
  kind: 'sync_cursor' as const,
  user_id: USER_ID,
  environment: 'test',
  issued_at: 1_000,
  expires_at: 2_000,
  data: { sequence: 42 },
};

describe('opaque HMAC tokens', () => {
  it('round-trips a user, environment, and kind-bound payload', async () => {
    const token = await signOpaqueToken(payload, KEY);

    await expect(
      verifyOpaqueToken(token, KEY, {
        kind: 'sync_cursor',
        user_id: USER_ID,
        environment: 'test',
        now: 1_500,
      }),
    ).resolves.toEqual(payload);
  });

  it('rejects tampering and binding mismatches', async () => {
    const token = await signOpaqueToken(payload, KEY);
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    await expect(
      verifyOpaqueToken(tampered, KEY, {
        kind: 'sync_cursor',
        user_id: USER_ID,
        environment: 'test',
        now: 1_500,
      }),
    ).rejects.toThrow('signature');
    await expect(
      verifyOpaqueToken(token, KEY, {
        kind: 'snapshot',
        user_id: USER_ID,
        environment: 'test',
        now: 1_500,
      }),
    ).rejects.toThrow('binding');
  });

  it('rejects expired tokens and weak signing keys', async () => {
    const token = await signOpaqueToken(payload, KEY);

    await expect(
      verifyOpaqueToken(token, KEY, {
        kind: 'sync_cursor',
        user_id: USER_ID,
        environment: 'test',
        now: 2_001,
      }),
    ).rejects.toThrow('expired');
    await expect(signOpaqueToken(payload, 'short')).rejects.toThrow('32');
  });
});
