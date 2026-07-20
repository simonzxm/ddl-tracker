import type { Client } from 'pg';

import { HttpError } from '../http/errors.js';

type ContentTargetType = 'course_task' | 'proposal' | 'comment';
type ReportStatus = 'open' | 'resolved' | 'dismissed';

interface ContentMutationRow {
  class_section_id: string;
  revision: number;
}

export class PostgresModerationRepository {
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

  async setContentHidden(input: {
    actorId: string;
    targetType: ContentTargetType;
    targetId: string;
    hidden: boolean;
    reason: string;
    requestId: string;
  }): Promise<{
    state: 'visible' | 'hidden';
    revision: number;
    changed: boolean;
  }> {
    return this.#transaction(async () => {
      const desired = input.hidden ? 'hidden' : 'visible';
      const current = await this.#loadContent(input.targetType, input.targetId);
      if (current.state === desired) {
        await this.#audit({
          actorId: input.actorId,
          action: `${input.targetType}_${input.hidden ? 'hidden' : 'restored'}`,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          requestId: input.requestId,
          result: {
            state: desired,
            revision: current.revision,
            changed: false,
          },
          now: this.#now(),
        });
        return { state: desired, revision: current.revision, changed: false };
      }
      if (current.state === 'merged' || current.state === 'redirected') {
        throw new HttpError({
          code: 'conflict',
          message: 'Redirected content cannot be moderated directly.',
          status: 409,
        });
      }

      const now = this.#now();
      const updated = await this.#updateContent(
        input.targetType,
        input.targetId,
        desired,
        now,
      );
      const action = input.hidden ? 'hide' : 'restore';
      const eventType = `${this.#eventPrefix(input.targetType)}_${
        input.hidden ? 'hidden' : 'restored'
      }`;
      await this.#client.query(
        `insert into moderation_actions (
           id, actor_id, action, target_type, target_id, reason,
           request_id, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          this.#createId(), input.actorId, action, input.targetType,
          input.targetId, input.reason, input.requestId, now,
        ],
      );
      await this.#audit({
        actorId: input.actorId,
        action: `${input.targetType}_${input.hidden ? 'hidden' : 'restored'}`,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        requestId: input.requestId,
        result: { state: desired, revision: updated.revision },
        now,
      });
      await this.#client.query(
        `insert into sync_events (
           event_id, scope, class_section_id, type, schema_version,
           payload, occurred_at
         ) values ($1, 'class_section_public', $2, $3, 1, $4::jsonb, $5)`,
        [
          this.#createId(), updated.class_section_id, eventType,
          JSON.stringify({
            target_type: input.targetType,
            target_id: input.targetId,
            state: desired,
            revision: updated.revision,
          }),
          now,
        ],
      );
      return { state: desired, revision: updated.revision, changed: true };
    });
  }

  async listReports(input: {
    status?: ReportStatus;
    limit: number;
    afterCreatedAt?: Date;
    afterId?: string;
  }): Promise<{
    reports: Record<string, unknown>[];
    next: { created_at: string; id: string } | null;
  }> {
    this.#validateLimit(input.limit);
    if ((input.afterCreatedAt === undefined) !== (input.afterId === undefined)) {
      throw invalidPagination();
    }
    const values: unknown[] = [];
    const predicates: string[] = [];
    if (input.status !== undefined) {
      values.push(input.status);
      predicates.push(`status = $${String(values.length)}`);
    }
    if (input.afterCreatedAt !== undefined && input.afterId !== undefined) {
      values.push(input.afterCreatedAt, input.afterId);
      predicates.push(
        `(created_at, id) > ($${String(values.length - 1)}, $${String(values.length)})`,
      );
    }
    values.push(input.limit + 1);
    const where = predicates.length === 0 ? '' : `where ${predicates.join(' and ')}`;
    const result = await this.#client.query<{
      id: string;
      reporter_id: string;
      target_type: string;
      target_id: string;
      reason: string;
      details: string | null;
      status: ReportStatus;
      resolution: string | null;
      resolved_by: string | null;
      created_at: Date;
      resolved_at: Date | null;
    }>(
      `select id, reporter_id, target_type, target_id, reason, details,
              status, resolution, resolved_by, created_at, resolved_at
       from content_reports
       ${where}
       order by created_at, id
       limit $${String(values.length)}`,
      values,
    );
    const hasMore = result.rows.length > input.limit;
    const selected = result.rows.slice(0, input.limit);
    const last = selected.at(-1);
    return {
      reports: selected.map((report) => ({
        id: report.id,
        reporter_id: report.reporter_id,
        target_type: report.target_type,
        target_id: report.target_id,
        reason: report.reason,
        details: report.details,
        status: report.status,
        resolution: report.resolution,
        resolved_by: report.resolved_by,
        created_at: report.created_at.toISOString(),
        resolved_at: report.resolved_at?.toISOString() ?? null,
      })),
      next:
        hasMore && last !== undefined
          ? { created_at: last.created_at.toISOString(), id: last.id }
          : null,
    };
  }

  async resolveReport(input: {
    actorId: string;
    reportId: string;
    status: Exclude<ReportStatus, 'open'>;
    resolution: string;
    requestId: string;
  }): Promise<{ status: Exclude<ReportStatus, 'open'> }> {
    return this.#transaction(async () => {
      const result = await this.#client.query<{
        reporter_id: string;
        target_type: string;
        target_id: string;
        reason: string;
        details: string | null;
        status: ReportStatus;
      }>(
        `select reporter_id, target_type, target_id, reason, details, status
         from content_reports
         where id = $1
         for update`,
        [input.reportId],
      );
      const report = result.rows[0];
      if (report === undefined) throw notFound('Report not found.');
      if (report.status !== 'open') {
        throw new HttpError({
          code: 'conflict',
          message: 'Report has already been resolved.',
          status: 409,
        });
      }
      const now = this.#now();
      await this.#client.query(
        `update content_reports
         set status = $2, resolution = $3, resolved_by = $4,
             resolved_at = $5
         where id = $1`,
        [input.reportId, input.status, input.resolution, input.actorId, now],
      );
      const reporterPayload = {
        report_id: input.reportId,
        status: input.status,
        resolution: input.resolution,
        resolved_at: now.toISOString(),
      };
      await this.#client.query(
        `insert into sync_events (
           event_id, scope, scope_user_id, type, schema_version,
           payload, occurred_at
         ) values
           ($1, 'private_user', $2, 'content_report_status_updated', 1,
            $3::jsonb, $4),
           ($5, 'maintainer_private', null,
            'content_report_status_updated', 1, $6::jsonb, $4)`,
        [
          this.#createId(), report.reporter_id,
          JSON.stringify(reporterPayload), now, this.#createId(),
          JSON.stringify({
            ...reporterPayload,
            reporter_id: report.reporter_id,
            target_type: report.target_type,
            target_id: report.target_id,
            reason: report.reason,
            details: report.details,
          }),
        ],
      );
      await this.#audit({
        actorId: input.actorId,
        action: input.status === 'resolved' ? 'report_resolved' : 'report_dismissed',
        targetType: 'report',
        targetId: input.reportId,
        reason: input.resolution,
        requestId: input.requestId,
        result: { status: input.status },
        now,
      });
      return { status: input.status };
    });
  }

  async listAudit(input: {
    limit: number;
    afterCreatedAt?: Date;
    afterId?: string;
  }): Promise<{
    entries: Record<string, unknown>[];
    next: { created_at: string; id: string } | null;
  }> {
    this.#validateLimit(input.limit);
    if ((input.afterCreatedAt === undefined) !== (input.afterId === undefined)) {
      throw invalidPagination();
    }
    const values: unknown[] = [];
    let where = '';
    if (input.afterCreatedAt !== undefined && input.afterId !== undefined) {
      values.push(input.afterCreatedAt, input.afterId);
      where = 'where (created_at, id) > ($1, $2)';
    }
    values.push(input.limit + 1);
    const result = await this.#client.query<{
      id: string;
      actor_id: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      reason: string | null;
      result: unknown;
      request_id: string;
      created_at: Date;
    }>(
      `select id, actor_id, action, target_type, target_id, reason,
              result, request_id, created_at
       from audit_log
       ${where}
       order by created_at, id
       limit $${String(values.length)}`,
      values,
    );
    const hasMore = result.rows.length > input.limit;
    const selected = result.rows.slice(0, input.limit);
    const last = selected.at(-1);
    return {
      entries: selected.map((entry) => ({
        id: entry.id,
        actor_id: entry.actor_id,
        action: entry.action,
        target_type: entry.target_type,
        target_id: entry.target_id,
        reason: entry.reason,
        result: entry.result,
        request_id: entry.request_id,
        created_at: entry.created_at.toISOString(),
      })),
      next:
        hasMore && last !== undefined
          ? { created_at: last.created_at.toISOString(), id: last.id }
          : null,
    };
  }

  async #loadContent(
    targetType: ContentTargetType,
    targetId: string,
  ): Promise<{ state: string; revision: number }> {
    if (targetType === 'course_task') {
      const result = await this.#client.query<{ state: string; revision: number }>(
        'select state, revision from course_tasks where id = $1 for update',
        [targetId],
      );
      return foundContent(result.rows[0]);
    }
    if (targetType === 'proposal') {
      const result = await this.#client.query<{ state: string; revision: number }>(
        'select state, revision from task_proposals where id = $1 for update',
        [targetId],
      );
      return foundContent(result.rows[0]);
    }
    const result = await this.#client.query<{ state: string; revision: number }>(
      `select state, current_revision as revision
       from task_comments where id = $1 for update`,
      [targetId],
    );
    return foundContent(result.rows[0]);
  }

  async #updateContent(
    targetType: ContentTargetType,
    targetId: string,
    state: 'visible' | 'hidden',
    now: Date,
  ): Promise<ContentMutationRow> {
    if (targetType === 'course_task') {
      const result = await this.#client.query<ContentMutationRow>(
        `update course_tasks
         set state = $2, revision = revision + 1, updated_at = $3
         where id = $1
         returning class_section_id, revision`,
        [targetId, state, now],
      );
      return requiredRow(result.rows[0]);
    }
    if (targetType === 'proposal') {
      const result = await this.#client.query<ContentMutationRow>(
        `update task_proposals p
         set state = $2, revision = p.revision + 1
         from course_tasks t
         where p.id = $1 and t.id = p.task_id
         returning t.class_section_id, p.revision`,
        [targetId, state],
      );
      return requiredRow(result.rows[0]);
    }
    const result = await this.#client.query<ContentMutationRow>(
      `update task_comments c
       set state = $2, updated_at = $3
       from course_tasks t
       where c.id = $1 and t.id = c.task_id
       returning t.class_section_id, c.current_revision as revision`,
      [targetId, state, now],
    );
    return requiredRow(result.rows[0]);
  }

  #eventPrefix(targetType: ContentTargetType): string {
    switch (targetType) {
      case 'course_task': return 'course_task';
      case 'proposal': return 'task_proposal';
      case 'comment': return 'task_comment';
    }
  }

  #validateLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidPagination();
    }
  }

  async #audit(input: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    requestId: string;
    result: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    await this.#client.query(
      `insert into audit_log (
         id, actor_id, action, target_type, target_id, reason, result,
         request_id, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        this.#createId(), input.actorId, input.action, input.targetType,
        input.targetId, input.reason, JSON.stringify(input.result),
        input.requestId, input.now,
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

function foundContent<T extends { state: string; revision: number }>(
  row: T | undefined,
): T {
  if (row === undefined) throw notFound('Content not found.');
  return row;
}

function requiredRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('Moderation update returned no row.');
  return row;
}

function notFound(message: string): HttpError {
  return new HttpError({ code: 'not_found', message, status: 404 });
}

function invalidPagination(): HttpError {
  return new HttpError({
    code: 'invalid_request',
    message: 'Admin pagination is invalid.',
    status: 400,
  });
}
