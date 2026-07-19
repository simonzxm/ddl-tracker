import { describe, expect, it } from 'vitest';

import {
  AccountLifecycleService,
  type AccountLifecycleRepository,
} from '../src/auth/account-lifecycle-service.js';
import type { PublicUser } from '../src/auth/account-service.js';

const USER_ID = '018f0000-0000-7000-8000-000000000001';
const user: PublicUser = {
  id: USER_ID,
  username: 'student',
  displayName: 'Student',
  status: 'active',
  profileRevision: 1,
};

class FakeLifecycleRepository implements AccountLifecycleRepository {
  updateOutcome:
    | { kind: 'success'; user: PublicUser }
    | { kind: 'revision_conflict'; current: PublicUser }
    | { kind: 'username_taken' } = { kind: 'success', user };
  deleteOutcome: 'deleted' | 'last_maintainer' | 'not_found' = 'deleted';

  updateProfile(): Promise<typeof this.updateOutcome> {
    return Promise.resolve(this.updateOutcome);
  }

  deleteAccount(): Promise<typeof this.deleteOutcome> {
    return Promise.resolve(this.deleteOutcome);
  }
}

describe('AccountLifecycleService', () => {
  it('validates and updates a profile with expected revision', async () => {
    const repository = new FakeLifecycleRepository();
    repository.updateOutcome = {
      kind: 'success',
      user: { ...user, username: 'new_name', profileRevision: 2 },
    };
    const service = new AccountLifecycleService({ repository });

    await expect(
      service.updateProfile(USER_ID, {
        username: 'new_name',
        displayName: 'New Name',
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ username: 'new_name', profileRevision: 2 });
  });

  it('returns the current profile on revision conflict', async () => {
    const repository = new FakeLifecycleRepository();
    repository.updateOutcome = {
      kind: 'revision_conflict',
      current: { ...user, profileRevision: 2 },
    };
    const service = new AccountLifecycleService({ repository });

    await expect(
      service.updateProfile(USER_ID, {
        username: 'new_name',
        displayName: 'New Name',
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      details: { current_revision: 2 },
    });
  });

  it('maps username conflicts and invalid profiles to stable errors', async () => {
    const repository = new FakeLifecycleRepository();
    repository.updateOutcome = { kind: 'username_taken' };
    const service = new AccountLifecycleService({ repository });

    await expect(
      service.updateProfile(USER_ID, {
        username: 'taken_name',
        displayName: 'Name',
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'username_taken' });
    await expect(
      service.updateProfile(USER_ID, {
        username: 'INVALID',
        displayName: 'Name',
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('deletes a normal account but protects the final maintainer', async () => {
    const repository = new FakeLifecycleRepository();
    const service = new AccountLifecycleService({ repository });
    await expect(service.deleteAccount(USER_ID)).resolves.toBeUndefined();

    repository.deleteOutcome = 'last_maintainer';
    await expect(service.deleteAccount(USER_ID)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
