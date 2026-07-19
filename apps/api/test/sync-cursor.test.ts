import { describe, expect, it } from 'vitest';

import { SyncCursorCodec } from '../src/sync/cursor.js';

const USER_ID = '018f0000-0000-7000-8000-000000002101';
const SECRET = '0123456789abcdef0123456789abcdef';

describe('SyncCursorCodec', () => {
  it('round-trips a versioned sequence bound to user and environment', async () => {
    const codec = new SyncCursorCodec(SECRET, 'staging');
    const cursor = await codec.encode(USER_ID, 42);

    await expect(codec.decode(cursor, USER_ID)).resolves.toEqual({
      sequence: 42,
    });
  });

  it('rejects tampering, another user, and another environment', async () => {
    const codec = new SyncCursorCodec(SECRET, 'staging');
    const cursor = await codec.encode(USER_ID, 42);

    await expect(
      codec.decode(`${cursor.slice(0, -1)}x`, USER_ID),
    ).rejects.toThrow('cursor');
    await expect(
      codec.decode(
        cursor,
        '018f0000-0000-7000-8000-000000002102',
      ),
    ).rejects.toThrow('cursor');
    await expect(
      new SyncCursorCodec(SECRET, 'production').decode(cursor, USER_ID),
    ).rejects.toThrow('cursor');
  });

  it('rejects malformed and unsafe sequence values', async () => {
    const codec = new SyncCursorCodec(SECRET, 'staging');
    await expect(codec.decode('invalid', USER_ID)).rejects.toThrow('cursor');
    await expect(codec.encode(USER_ID, -1)).rejects.toThrow('sequence');
  });
});
