import {
  createUuidV7,
  evidenceUrlSchema,
  nullableNormalizedTextSchema,
  parseDisplayName,
  parseUsername,
} from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';
import type { PublicUser } from './account-service.js';

export type ProfileUpdateOutcome =
  | { kind: 'success'; user: PublicUser }
  | { kind: 'revision_conflict'; current: PublicUser }
  | { kind: 'username_taken' };

export interface AccountLifecycleRepository {
  updateProfile(input: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    expectedRevision: number;
    now: Date;
    eventId: string;
  }): Promise<ProfileUpdateOutcome>;
  deleteAccount(
    userId: string,
    now: Date,
    eventId: string,
  ): Promise<'deleted' | 'last_maintainer' | 'not_found'>;
}

export class AccountLifecycleService {
  readonly #repository: AccountLifecycleRepository;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: {
    repository: AccountLifecycleRepository;
    now?: () => Date;
    createId?: () => string;
  }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? createUuidV7;
  }

  async updateProfile(
    userId: string,
    input: {
      username: string;
      displayName: string;
      avatarUrl: string | null;
      bio: string | null;
      expectedRevision: number;
    },
  ): Promise<PublicUser> {
    let username: string;
    let displayName: string;
    let avatarUrl: string | null;
    let bio: string | null;
    try {
      username = parseUsername(input.username);
      displayName = parseDisplayName(input.displayName);
      avatarUrl = evidenceUrlSchema.nullable().parse(input.avatarUrl);
      bio = nullableNormalizedTextSchema(500).parse(input.bio);
    } catch (error) {
      throw new HttpError({
        code: 'invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid account profile.',
        status: 400,
      });
    }

    const outcome = await this.#repository.updateProfile({
      userId,
      username,
      displayName,
      avatarUrl,
      bio,
      expectedRevision: input.expectedRevision,
      now: this.#now(),
      eventId: this.#createId(),
    });
    if (outcome.kind === 'success') {
      return outcome.user;
    }
    if (outcome.kind === 'username_taken') {
      throw new HttpError({
        code: 'username_taken',
        message: 'Username is already in use.',
        status: 409,
      });
    }
    throw new HttpError({
      code: 'revision_conflict',
      message: 'Profile revision does not match.',
      status: 409,
      details: {
        current_revision: outcome.current.profileRevision,
        current: {
          id: outcome.current.id,
          username: outcome.current.username,
          display_name: outcome.current.displayName,
          avatar_url: outcome.current.avatarUrl,
          bio: outcome.current.bio,
          status: outcome.current.status,
          profile_revision: outcome.current.profileRevision,
        },
      },
    });
  }

  async deleteAccount(userId: string): Promise<void> {
    const outcome = await this.#repository.deleteAccount(
      userId,
      this.#now(),
      this.#createId(),
    );
    if (outcome === 'deleted') {
      return;
    }
    if (outcome === 'last_maintainer') {
      throw new HttpError({
        code: 'conflict',
        message: 'The final maintainer account cannot be deleted.',
        status: 409,
      });
    }
    throw new HttpError({
      code: 'not_found',
      message: 'Account not found.',
      status: 404,
    });
  }
}
