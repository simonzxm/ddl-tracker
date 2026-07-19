import { describe, expect, it, vi } from 'vitest';

import { MaintainerAccessService } from '../src/admin/maintainer-access-service.js';

const USER_ID = '018f0000-0000-7000-8000-000000003301';
const REQUEST_ID = '018f0000-0000-7000-8000-000000003302';

describe('MaintainerAccessService', () => {
  it('rejects an invalid bootstrap token before touching storage', async () => {
    const repository = {
      bootstrap: vi.fn(async () => ({ maintainer: true as const })),
    };
    const service = new MaintainerAccessService(repository, 'expected-secret');

    await expect(
      service.bootstrap({
        actorId: USER_ID,
        requestId: REQUEST_ID,
        bootstrapToken: 'wrong-secret',
      }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(repository.bootstrap).not.toHaveBeenCalled();
  });

  it('delegates a valid bootstrap token without returning the secret', async () => {
    const repository = {
      bootstrap: vi.fn(async () => ({ maintainer: true as const })),
    };
    const service = new MaintainerAccessService(repository, 'expected-secret');

    await expect(
      service.bootstrap({
        actorId: USER_ID,
        requestId: REQUEST_ID,
        bootstrapToken: 'expected-secret',
      }),
    ).resolves.toEqual({ maintainer: true });
    expect(repository.bootstrap).toHaveBeenCalledWith({
      actorId: USER_ID,
      requestId: REQUEST_ID,
    });
  });
});
