import { describe, expect, it, vi } from 'vitest';

import { withConnectedClient } from '../src/db/client.js';

interface FakeClient {
  connect: () => Promise<void>;
  end: () => Promise<void>;
}

function fakeClient(): FakeClient {
  return {
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
  };
}

describe('withConnectedClient', () => {
  it('connects before use and closes after success', async () => {
    const client = fakeClient();
    const events: string[] = [];
    client.connect = vi.fn(async () => {
      events.push('connect');
    });
    client.end = vi.fn(async () => {
      events.push('end');
    });

    const result = await withConnectedClient(
      () => client,
      async (connected) => {
        events.push('use');
        expect(connected).toBe(client);
        return 42;
      },
    );

    expect(result).toBe(42);
    expect(events).toEqual(['connect', 'use', 'end']);
  });

  it('closes the client when request work throws', async () => {
    const client = fakeClient();

    await expect(
      withConnectedClient(
        () => client,
        async () => {
          throw new Error('request failed');
        },
      ),
    ).rejects.toThrow('request failed');
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('does not call end when connection setup never succeeds', async () => {
    const client = fakeClient();
    client.connect = vi.fn(async () => {
      throw new Error('connect failed');
    });

    await expect(
      withConnectedClient(() => client, async () => undefined),
    ).rejects.toThrow('connect failed');
    expect(client.end).not.toHaveBeenCalled();
  });
});
