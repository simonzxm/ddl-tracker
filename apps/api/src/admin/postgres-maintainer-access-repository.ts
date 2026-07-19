import type { Client } from 'pg';

import { HttpError } from '../http/errors.js';

const MAINTAINER_LOCK = 4_819_251;

export class PostgresMaintainerAccessRepository {
  readonly #client: Client;
  readonly #createId: () => string;
  readonly #now: () => Date;

  constructor(
    client: Client,
    options: { createId: () => string; now?: () => Date },
  ) {
    this.#client = client;
    this.#createId = options.createId;
    this.#now = options.now ?? (() => new Date());
  }

  async bootstrap(input: {
    actorId: string;
    requestId: string;
  }): Promise<{ maintainer: true }> {
    return this.#transaction(async () => {
      await this.#lockMaintainers();
      const existing = await this.#client.query<{ count: string }>(
        `select count(*)::text as count
         from user_roles
         where role = 'maintainer'`,
      );
      if (existing.rows[0]?.count !== '0') {
        throw conflict('Maintainer bootstrap is already closed.');
      }
      await this.#requireActiveUser(input.actorId);
      await this.#client.query(
        `insert into user_roles (user_id, role, granted_by)
         values ($1, 'maintainer', $1)`,
        [input.actorId],
      );
      await this.#audit({
        actorId: input.actorId,
        action: 'maintainer_bootstrap',
        targetType: 'user',
        targetId: input.actorId,
        reason: 'Initial maintainer bootstrap.',
        requestId: input.requestId,
        result: { maintainer: true },
      });
      return { maintainer: true };
    });
  }

  async setMaintainerRole(input: {
    actorId: string;
    targetUserId: string;
    maintainer: boolean;
    reason: string;
    requestId: string;
  }): Promise<{ maintainer: boolean; changed: boolean }> {
    return this.#transaction(async () => {
      await this.#lockMaintainers();
      await this.#requireActiveUser(input.targetUserId);
      const current = await this.#client.query(
        `select 1 from user_roles
         where user_id = $1 and role = 'maintainer'
         limit 1`,
        [input.targetUserId],
      );
      const hasRole = current.rowCount === 1;
      if (input.maintainer === hasRole) {
        return { maintainer: input.maintainer, changed: false };
      }
      if (input.maintainer) {
        await this.#client.query(
          `insert into user_roles (user_id, role, granted_by)
           values ($1, 'maintainer', $2)`,
          [input.targetUserId, input.actorId],
        );
      } else {
        const activeCount = await this.#activeMaintainerCount();
        const target = await this.#client.query<{ status: string }>(
          'select status from users where id = $1',
          [input.targetUserId],
        );
        if (target.rows[0]?.status === 'active' && activeCount <= 1) {
          throw conflict('The final active maintainer cannot be removed.');
        }
        await this.#client.query(
          `delete from user_roles
           where user_id = $1 and role = 'maintainer'`,
          [input.targetUserId],
        );
      }
      await this.#audit({
        actorId: input.actorId,
        action: input.maintainer ? 'maintainer_granted' : 'maintainer_revoked',
        targetType: 'user',
        targetId: input.targetUserId,
        reason: input.reason,
        requestId: input.requestId,
        result: { maintainer: input.maintainer },
      });
      return { maintainer: input.maintainer, changed: true };
    });
  }

  async setUserSuspended(input: {
    actorId: string;
    targetUserId: string;
    suspended: boolean;
    reason: string;
    requestId: string;
  }): Promise<{ status: 'active' | 'suspended'; changed: boolean }> {
    return this.#transaction(async () => {
      await this.#lockMaintainers();
      const user = await this.#client.query<{
        status: 'active' | 'suspended' | 'deleted';
        maintainer: boolean;
      }>(
        `select u.status,
                exists (
                  select 1 from user_roles r
                  where r.user_id = u.id and r.role = 'maintainer'
                ) as maintainer
         from users u
         where u.id = $1
         for update`,
        [input.targetUserId],
      );
      const row = user.rows[0];
      if (row === undefined || row.status === 'deleted') {
        throw notFound('User not found.');
      }
      const desired = input.suspended ? 'suspended' : 'active';
      if (row.status === desired) {
        return { status: desired, changed: false };
      }
      if (input.suspended && row.maintainer) {
        const activeCount = await this.#activeMaintainerCount();
        if (activeCount <= 1) {
          throw conflict('The final active maintainer cannot be suspended.');
        }
      }
      const now = this.#now();
      await this.#client.query(
        `update users
         set status = $2, profile_revision = profile_revision + 1,
             updated_at = $3
         where id = $1`,
        [input.targetUserId, desired, now],
      );
      if (input.suspended) {
        await this.#client.query(
          `update sessions
           set revoked_at = $2
           where user_id = $1 and revoked_at is null`,
          [input.targetUserId, now],
        );
      }
      const action = input.suspended ? 'suspend' : 'unsuspend';
      await this.#client.query(
        `insert into moderation_actions (
           id, actor_id, action, target_type, target_id, reason,
           request_id, created_at
         ) values ($1, $2, $3, 'user', $4, $5, $6, $7)`,
        [
          this.#createId(),
          input.actorId,
          action,
          input.targetUserId,
          input.reason,
          input.requestId,
          now,
        ],
      );
      await this.#audit({
        actorId: input.actorId,
        action: input.suspended ? 'user_suspended' : 'user_restored',
        targetType: 'user',
        targetId: input.targetUserId,
        reason: input.reason,
        requestId: input.requestId,
        result: { status: desired },
      });
      await this.#client.query(
        `insert into sync_events (
           event_id, scope, type, schema_version, payload, occurred_at
         ) values ($1, 'authenticated_global', 'public_user_profile_updated',
                   1, $2::jsonb, $3)`,
        [
          this.#createId(),
          JSON.stringify({ user_id: input.targetUserId, status: desired }),
          now,
        ],
      );
      return { status: desired, changed: true };
    });
  }

  async #requireActiveUser(userId: string): Promise<void> {
    const user = await this.#client.query(
      `select 1 from users
       where id = $1 and status = 'active'
       limit 1`,
      [userId],
    );
    if (user.rowCount !== 1) throw notFound('Active user not found.');
  }

  async #activeMaintainerCount(): Promise<number> {
    const result = await this.#client.query<{ count: string }>(
      `select count(*)::text as count
       from user_roles r
       join users u on u.id = r.user_id
       where r.role = 'maintainer' and u.status = 'active'`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async #lockMaintainers(): Promise<void> {
    await this.#client.query('select pg_advisory_xact_lock($1)', [
      MAINTAINER_LOCK,
    ]);
  }

  async #audit(input: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    requestId: string;
    result: Record<string, unknown>;
  }): Promise<void> {
    await this.#client.query(
      `insert into audit_log (
         id, actor_id, action, target_type, target_id, reason, result,
         request_id, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        this.#createId(),
        input.actorId,
        input.action,
        input.targetType,
        input.targetId,
        input.reason,
        JSON.stringify(input.result),
        input.requestId,
        this.#now(),
      ],
    );
  }

  async #transaction<T>(use: () => Promise<T>): Promise<T> {
    await this.#client.query('begin');
    try {
      const value = await use();
      await this.#client.query('commit');
      return value;
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }
}

function conflict(message: string): HttpError {
  return new HttpError({ code: 'conflict', message, status: 409 });
}

function notFound(message: string): HttpError {
  return new HttpError({ code: 'not_found', message, status: 404 });
}
