import type { Client } from 'pg';

import type { PublicUser } from './account-service.js';
import type {
  AccountLifecycleRepository,
  ProfileUpdateOutcome,
} from './account-lifecycle-service.js';
import { PostgresSyncEventStore } from '../sync/postgres-event-store.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  status: PublicUser['status'];
  profile_revision: number;
  created_at: Date;
  updated_at: Date;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    profileRevision: row.profile_revision,
  };
}

function isUsernameConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'users_username_key_unique'
  );
}

export class PostgresAccountLifecycleRepository
  implements AccountLifecycleRepository
{
  readonly #client: Client;
  readonly #events: PostgresSyncEventStore;

  constructor(client: Client) {
    this.#client = client;
    this.#events = new PostgresSyncEventStore(client, {
      createId: () => {
        throw new Error('Account lifecycle events require an explicit event ID.');
      },
    });
  }

  async updateProfile(input: {
    userId: string;
    username: string;
    displayName: string;
    expectedRevision: number;
    now: Date;
    eventId: string;
  }): Promise<ProfileUpdateOutcome> {
    await this.#client.query('begin');
    try {
      let updated;
      try {
        updated = await this.#client.query<UserRow>(
          `update users
           set username = $2,
               username_key = $2,
               display_name = $3,
               profile_revision = profile_revision + 1,
               updated_at = $5
           where id = $1
             and status = 'active'
             and profile_revision = $4
           returning id, username, display_name, avatar_url, bio, status,
                     profile_revision, created_at, updated_at`,
          [
            input.userId,
            input.username,
            input.displayName,
            input.expectedRevision,
            input.now,
          ],
        );
      } catch (error) {
        if (isUsernameConflict(error)) {
          await this.#client.query('rollback');
          return { kind: 'username_taken' };
        }
        throw error;
      }

      const row = updated.rows[0];
      if (row === undefined) {
        const current = await this.#client.query<UserRow>(
          `select id, username, display_name, avatar_url, bio, status,
                  profile_revision, created_at, updated_at
           from users where id = $1 limit 1`,
          [input.userId],
        );
        const currentRow = current.rows[0];
        if (currentRow === undefined) {
          throw new Error('Authenticated user disappeared during profile update.');
        }
        await this.#client.query('commit');
        return { kind: 'revision_conflict', current: toPublicUser(currentRow) };
      }

      const user = toPublicUser(row);
      if (row.status === 'deleted') {
        throw new Error('A deleted user cannot emit a public profile update.');
      }
      await this.#events.append({
        scope: 'authenticated_global',
        eventId: input.eventId,
        occurredAt: input.now,
        event: {
          type: 'public_user_profile_updated',
          payload: {
            id: row.id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            bio: row.bio,
            status: row.status,
            revision: row.profile_revision,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
          },
        },
      });
      await this.#client.query('commit');
      return { kind: 'success', user };
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }

  async deleteAccount(
    userId: string,
    now: Date,
    eventId: string,
  ): Promise<'deleted' | 'last_maintainer' | 'not_found'> {
    await this.#client.query('begin');
    try {
      const existing = await this.#client.query<{
        id: string;
        status: PublicUser['status'];
        profile_revision: number;
      }>(
        `select id, status, profile_revision
         from users where id = $1 for update`,
        [userId],
      );
      const user = existing.rows[0];
      if (user === undefined || user.status === 'deleted') {
        await this.#client.query('rollback');
        return 'not_found';
      }

      const role = await this.#client.query<{ count: string }>(
        `select count(*)::text as count
         from user_roles r
         join users u on u.id = r.user_id
         where r.role = 'maintainer'
           and u.status = 'active'
           and exists (
             select 1 from user_roles own
             where own.user_id = $1 and own.role = 'maintainer'
           )`,
        [userId],
      );
      if (Number(role.rows[0]?.count ?? '0') <= 1 && role.rows[0] !== undefined) {
        const ownsMaintainerRole = await this.#client.query(
          `select 1 from user_roles
           where user_id = $1 and role = 'maintainer' limit 1`,
          [userId],
        );
        if (ownsMaintainerRole.rowCount === 1) {
          await this.#client.query('rollback');
          return 'last_maintainer';
        }
      }

      const anonymizeStatements = [
        'update course_tasks set created_by = null where created_by = $1',
        'update task_proposals set author_id = null where author_id = $1',
        'update task_comments set author_id = null where author_id = $1',
        'update comment_revisions set author_id = null where author_id = $1',
      ];
      for (const statement of anonymizeStatements) {
        await this.#client.query(statement, [userId]);
      }

      const privateDeleteStatements = [
        'delete from content_reports where reporter_id = $1',
        "delete from sync_events where scope = 'private_user' and scope_user_id = $1",
        'delete from operation_receipts where user_id = $1',
        'delete from rate_limit_counters where subject_key = $1',
        'delete from personal_task_states where user_id = $1',
        'delete from personal_task_details where user_id = $1',
        'delete from personal_todos where user_id = $1',
        'delete from followed_class_sections where user_id = $1',
        'delete from sessions where user_id = $1',
        'delete from institutional_identities where user_id = $1',
        'delete from user_roles where user_id = $1',
      ];
      for (const statement of privateDeleteStatements) {
        await this.#client.query(statement, [userId]);
      }
      const nextRevision = user.profile_revision + 1;
      await this.#client.query(
        `update users
         set username = 'deleted_' || replace(id::text, '-', ''),
             username_key = 'deleted_' || replace(id::text, '-', ''),
             display_name = '已注销用户',
             avatar_url = null,
             bio = null,
             status = 'deleted',
             profile_revision = $2,
             updated_at = $3,
             deleted_at = $3
         where id = $1`,
        [userId, nextRevision, now],
      );
      await this.#events.append({
        scope: 'authenticated_global',
        eventId,
        occurredAt: now,
        event: {
          type: 'public_user_deleted',
          payload: {
            id: userId,
            display_name: '已注销用户',
            status: 'deleted',
            revision: nextRevision,
            deleted_at: now.toISOString(),
          },
        },
      });
      await this.#client.query('commit');
      return 'deleted';
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }
}
