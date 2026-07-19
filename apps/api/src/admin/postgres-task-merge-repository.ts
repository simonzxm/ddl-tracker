import type { Client } from 'pg';

import { HttpError } from '../http/errors.js';

interface TaskRow {
  id: string;
  class_section_id: string;
  state: 'visible' | 'hidden' | 'merged';
}

interface ProposalRow {
  id: string;
  task_id: string;
  content_fingerprint: string;
  state: 'visible' | 'hidden' | 'redirected';
}

interface VoteRow {
  user_id: string;
  direction: 'up' | 'down';
}

export class PostgresTaskMergeRepository {
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

  async merge(input: {
    actorId: string;
    sourceTaskId: string;
    targetTaskId: string;
    reason: string;
    requestId: string;
  }): Promise<{
    source_task_id: string;
    target_task_id: string;
    redirected_proposals: number;
    moved_proposals: number;
  }> {
    if (input.sourceTaskId === input.targetTaskId) {
      throw conflict('A task cannot be merged into itself.');
    }
    return this.#transaction(async () => {
      const tasks = await this.#lockTasks(
        input.sourceTaskId,
        input.targetTaskId,
      );
      const source = tasks.get(input.sourceTaskId);
      const target = tasks.get(input.targetTaskId);
      if (source === undefined || target === undefined) {
        throw notFound('Course task not found.');
      }
      if (source.class_section_id !== target.class_section_id) {
        throw conflict('Tasks must belong to the same class section.');
      }
      if (source.state === 'merged') {
        throw conflict('Source task is already merged.');
      }
      if (target.state === 'merged') {
        throw conflict('Target task must be canonical.');
      }
      const existing = await this.#client.query(
        'select 1 from task_merges where source_task_id = $1 limit 1',
        [input.sourceTaskId],
      );
      if (existing.rowCount === 1) {
        throw conflict('Source task is already redirected.');
      }

      const now = this.#now();
      const proposals = await this.#client.query<ProposalRow>(
        `select id, task_id, content_fingerprint, state
         from task_proposals
         where task_id = any($1::uuid[])
         order by created_at, id
         for update`,
        [[input.targetTaskId, input.sourceTaskId]],
      );
      const targetByFingerprint = new Map(
        proposals.rows
          .filter((proposal) => proposal.task_id === input.targetTaskId)
          .map((proposal) => [proposal.content_fingerprint, proposal]),
      );
      let redirected = 0;
      let moved = 0;
      for (const proposal of proposals.rows) {
        if (proposal.task_id !== input.sourceTaskId) continue;
        const canonical = targetByFingerprint.get(proposal.content_fingerprint);
        if (canonical === undefined) {
          await this.#client.query(
            'update task_proposals set task_id = $2 where id = $1',
            [proposal.id, input.targetTaskId],
          );
          targetByFingerprint.set(proposal.content_fingerprint, {
            ...proposal,
            task_id: input.targetTaskId,
          });
          moved += 1;
          continue;
        }
        await this.#mergeProposalVotes({
          sourceProposalId: proposal.id,
          canonicalProposalId: canonical.id,
          classSectionId: source.class_section_id,
          now,
        });
        await this.#client.query(
          `insert into proposal_redirects (
             source_proposal_id, canonical_proposal_id, created_at
           ) values ($1, $2, $3)`,
          [proposal.id, canonical.id, now],
        );
        await this.#client.query(
          `update task_proposals
           set state = 'redirected', revision = revision + 1
           where id = $1`,
          [proposal.id],
        );
        await this.#publicEvent(
          source.class_section_id,
          'task_proposal_redirected',
          {
            source_proposal_id: proposal.id,
            canonical_proposal_id: canonical.id,
            source_task_id: input.sourceTaskId,
            target_task_id: input.targetTaskId,
          },
          now,
        );
        redirected += 1;
      }

      await this.#client.query(
        'update task_comments set task_id = $2 where task_id = $1',
        [input.sourceTaskId, input.targetTaskId],
      );
      await this.#client.query(
        `update content_reports
         set target_id = $2
         where target_type = 'course_task' and target_id = $1`,
        [input.sourceTaskId, input.targetTaskId],
      );
      await this.#client.query(
        `update course_tasks
         set state = 'merged', revision = revision + 1, updated_at = $2
         where id = $1`,
        [input.sourceTaskId, now],
      );
      await this.#client.query(
        `insert into task_merges (
           source_task_id, target_task_id, maintainer_id, reason, created_at
         ) values ($1, $2, $3, $4, $5)`,
        [
          input.sourceTaskId,
          input.targetTaskId,
          input.actorId,
          input.reason,
          now,
        ],
      );
      await this.#publicEvent(
        source.class_section_id,
        'course_task_merged',
        {
          source_task_id: input.sourceTaskId,
          target_task_id: input.targetTaskId,
          redirected_proposals: redirected,
          moved_proposals: moved,
        },
        now,
      );
      await this.#audit({
        actorId: input.actorId,
        sourceTaskId: input.sourceTaskId,
        targetTaskId: input.targetTaskId,
        reason: input.reason,
        requestId: input.requestId,
        redirected,
        moved,
        now,
      });
      return {
        source_task_id: input.sourceTaskId,
        target_task_id: input.targetTaskId,
        redirected_proposals: redirected,
        moved_proposals: moved,
      };
    });
  }

  async #lockTasks(
    sourceTaskId: string,
    targetTaskId: string,
  ): Promise<Map<string, TaskRow>> {
    const result = await this.#client.query<TaskRow>(
      `select id, class_section_id, state
       from course_tasks
       where id = any($1::uuid[])
       order by id
       for update`,
      [[sourceTaskId, targetTaskId]],
    );
    return new Map(result.rows.map((task) => [task.id, task]));
  }

  async #mergeProposalVotes(input: {
    sourceProposalId: string;
    canonicalProposalId: string;
    classSectionId: string;
    now: Date;
  }): Promise<void> {
    const result = await this.#client.query<VoteRow & { proposal_id: string }>(
      `select user_id, proposal_id, direction
       from accuracy_votes
       where proposal_id = any($1::uuid[])
       order by user_id, proposal_id
       for update`,
      [[input.canonicalProposalId, input.sourceProposalId]],
    );
    const canonicalVotes = new Map(
      result.rows
        .filter((vote) => vote.proposal_id === input.canonicalProposalId)
        .map((vote) => [vote.user_id, vote.direction]),
    );
    for (const sourceVote of result.rows.filter(
      (vote) => vote.proposal_id === input.sourceProposalId,
    )) {
      const canonicalDirection = canonicalVotes.get(sourceVote.user_id);
      if (canonicalDirection === undefined) {
        await this.#client.query(
          `update accuracy_votes
           set proposal_id = $2, updated_at = $3
           where user_id = $1 and proposal_id = $4`,
          [
            sourceVote.user_id,
            input.canonicalProposalId,
            input.now,
            input.sourceProposalId,
          ],
        );
        canonicalVotes.set(sourceVote.user_id, sourceVote.direction);
        continue;
      }
      if (canonicalDirection === sourceVote.direction) {
        await this.#client.query(
          `delete from accuracy_votes
           where user_id = $1 and proposal_id = $2`,
          [sourceVote.user_id, input.sourceProposalId],
        );
        continue;
      }
      await this.#client.query(
        `delete from accuracy_votes
         where user_id = $1 and proposal_id = any($2::uuid[])`,
        [
          sourceVote.user_id,
          [input.sourceProposalId, input.canonicalProposalId],
        ],
      );
      canonicalVotes.delete(sourceVote.user_id);
      await this.#client.query(
        `insert into sync_events (
           event_id, scope, scope_user_id, type, schema_version,
           payload, occurred_at
         ) values ($1, 'private_user', $2, 'accuracy_vote_updated',
                   1, $3::jsonb, $4)`,
        [
          this.#createId(),
          sourceVote.user_id,
          JSON.stringify({
            proposal_id: input.canonicalProposalId,
            direction: 'none',
            reason: 'task_merge_conflict',
          }),
          input.now,
        ],
      );
    }
    await this.#recomputeTotals(input.canonicalProposalId, input.classSectionId, input.now);
    await this.#client.query(
      `insert into proposal_vote_totals (proposal_id, up, down, updated_at)
       values ($1, 0, 0, $2)
       on conflict (proposal_id) do update
       set up = 0, down = 0, updated_at = excluded.updated_at`,
      [input.sourceProposalId, input.now],
    );
  }

  async #recomputeTotals(
    proposalId: string,
    classSectionId: string,
    now: Date,
  ): Promise<void> {
    const totals = await this.#client.query<{ up: number; down: number }>(
      `select
         count(*) filter (where direction = 'up')::int as up,
         count(*) filter (where direction = 'down')::int as down
       from accuracy_votes
       where proposal_id = $1`,
      [proposalId],
    );
    const row = totals.rows[0] ?? { up: 0, down: 0 };
    await this.#client.query(
      `insert into proposal_vote_totals (proposal_id, up, down, updated_at)
       values ($1, $2, $3, $4)
       on conflict (proposal_id) do update
       set up = excluded.up, down = excluded.down,
           updated_at = excluded.updated_at`,
      [proposalId, row.up, row.down, now],
    );
    await this.#publicEvent(
      classSectionId,
      'proposal_vote_totals_updated',
      { proposal_id: proposalId, up: row.up, down: row.down },
      now,
    );
  }

  async #publicEvent(
    classSectionId: string,
    type: string,
    payload: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    await this.#client.query(
      `insert into sync_events (
         event_id, scope, class_section_id, type, schema_version,
         payload, occurred_at
       ) values ($1, 'class_section_public', $2, $3, 1, $4::jsonb, $5)`,
      [this.#createId(), classSectionId, type, JSON.stringify(payload), now],
    );
  }

  async #audit(input: {
    actorId: string;
    sourceTaskId: string;
    targetTaskId: string;
    reason: string;
    requestId: string;
    redirected: number;
    moved: number;
    now: Date;
  }): Promise<void> {
    await this.#client.query(
      `insert into audit_log (
         id, actor_id, action, target_type, target_id, reason, result,
         request_id, created_at
       ) values ($1, $2, 'course_task_merged', 'course_task', $3,
                 $4, $5::jsonb, $6, $7)`,
      [
        this.#createId(),
        input.actorId,
        input.sourceTaskId,
        input.reason,
        JSON.stringify({
          target_task_id: input.targetTaskId,
          redirected_proposals: input.redirected,
          moved_proposals: input.moved,
        }),
        input.requestId,
        input.now,
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
