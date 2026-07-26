import type { Client } from 'pg';

import { HttpError } from '../http/errors.js';
import {
  PostgresSyncEventStore,
  type SyncEventDraft,
} from '../sync/postgres-event-store.js';

type PrivateEventDraft = Extract<
  SyncEventDraft,
  { scope: 'private_user' }
>['event'];
type PublicEventDraft = Extract<
  SyncEventDraft,
  { scope: 'class_section_public' }
>['event'];
type PrivateDeletionReason =
  | 'task_merge_conflict'
  | 'task_merge_duplicate'
  | 'task_merge_moved'
  | 'task_merge_merged';

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
  direction: 'up' | 'down' | 'none';
  revision: number;
}

interface PrivateDetailsRow {
  user_id: string;
  task_id: string;
  private_title: string | null;
  private_deadline: Date | null;
  private_note: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface PrivateStateRow {
  user_id: string;
  task_id: string;
  state: 'pending' | 'completed' | 'ignored';
  revision: number;
  created_at: Date;
  updated_at: Date;
}

export class PostgresTaskMergeRepository {
  readonly #client: Client;
  readonly #events: PostgresSyncEventStore;
  readonly #createId: () => string;
  readonly #now: () => Date;

  constructor(
    client: Client,
    options: { createId: () => string; now?: () => Date },
  ) {
    this.#client = client;
    this.#events = new PostgresSyncEventStore(client, {
      createId: options.createId,
    });
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
    recovered_personal_todos: number;
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
        const redirectedProposal = await this.#client.query<{
          revision: number;
        }>(
          `update task_proposals
           set state = 'redirected', revision = revision + 1
           where id = $1
           returning revision`,
          [proposal.id],
        );
        const redirectRevision = requiredRow(redirectedProposal.rows[0]).revision;
        await this.#publicEvent(
          source.class_section_id,
          'task_proposal_redirected',
          {
            source_proposal_id: proposal.id,
            canonical_proposal_id: canonical.id,
            revision: redirectRevision,
            created_at: now.toISOString(),
          },
          now,
        );
        redirected += 1;
      }

      const recoveredPersonalTodos = await this.#mergePrivateOverlays({
        sourceTaskId: input.sourceTaskId,
        targetTaskId: input.targetTaskId,
        classSectionId: source.class_section_id,
        now,
      });

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
      const mergedTask = await this.#client.query<{ revision: number }>(
        `update course_tasks
         set state = 'merged', revision = revision + 1, updated_at = $2
         where id = $1
         returning revision`,
        [input.sourceTaskId, now],
      );
      const mergedRevision = requiredRow(mergedTask.rows[0]).revision;
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
          reason: input.reason,
          revision: mergedRevision,
          created_at: now.toISOString(),
          redirected_proposals: redirected,
          moved_proposals: moved,
          recovered_personal_todos: recoveredPersonalTodos,
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
        recoveredPersonalTodos,
        now,
      });
      return {
        source_task_id: input.sourceTaskId,
        target_task_id: input.targetTaskId,
        redirected_proposals: redirected,
        moved_proposals: moved,
        recovered_personal_todos: recoveredPersonalTodos,
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

  async #mergePrivateOverlays(input: {
    sourceTaskId: string;
    targetTaskId: string;
    classSectionId: string;
    now: Date;
  }): Promise<number> {
    const detailsResult = await this.#client.query<PrivateDetailsRow>(
      `select user_id, task_id, private_title, private_deadline, private_note,
              revision, created_at, updated_at
       from personal_task_details
       where task_id = any($1::uuid[])
       order by user_id, task_id
       for update`,
      [[input.sourceTaskId, input.targetTaskId]],
    );
    const statesResult = await this.#client.query<PrivateStateRow>(
      `select user_id, task_id, state, revision, created_at, updated_at
       from personal_task_states
       where task_id = any($1::uuid[])
       order by user_id, task_id
       for update`,
      [[input.sourceTaskId, input.targetTaskId]],
    );
    const details = new Map(
      detailsResult.rows.map((row) => [`${row.user_id}:${row.task_id}`, row]),
    );
    const states = new Map(
      statesResult.rows.map((row) => [`${row.user_id}:${row.task_id}`, row]),
    );
    const users = new Set<string>();
    for (const row of detailsResult.rows) {
      if (row.task_id === input.sourceTaskId) users.add(row.user_id);
    }
    for (const row of statesResult.rows) {
      if (row.task_id === input.sourceTaskId) users.add(row.user_id);
    }

    let recovered = 0;
    for (const userId of users) {
      const sourceDetails = details.get(`${userId}:${input.sourceTaskId}`);
      const targetDetails = details.get(`${userId}:${input.targetTaskId}`);
      const sourceState = states.get(`${userId}:${input.sourceTaskId}`);
      const targetState = states.get(`${userId}:${input.targetTaskId}`);

      if (sourceDetails !== undefined && targetDetails !== undefined) {
        if (!sameDetails(sourceDetails, targetDetails)) {
          const todoId = this.#createId();
          const todoState = sourceState?.state ?? 'pending';
          await this.#client.query(
            `insert into personal_todos (
               id, user_id, class_section_id, title, deadline, note, state,
               revision, created_at, updated_at
             ) values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8)`,
            [
              todoId,
              userId,
              input.classSectionId,
              sourceDetails.private_title ?? 'Recovered task details',
              sourceDetails.private_deadline,
              sourceDetails.private_note,
              todoState,
              input.now,
            ],
          );
          await this.#client.query(
            `delete from personal_task_details
             where user_id = $1 and task_id = $2`,
            [userId, input.sourceTaskId],
          );
          await this.#client.query(
            `delete from personal_task_states
             where user_id = $1 and task_id = $2`,
            [userId, input.sourceTaskId],
          );
          await this.#privateEvent(
            userId,
            'personal_todo_upserted',
            {
              id: todoId,
              class_section_id: input.classSectionId,
              title: sourceDetails.private_title ?? 'Recovered task details',
              deadline: sourceDetails.private_deadline?.toISOString() ?? null,
              note: sourceDetails.private_note,
              state: todoState,
              revision: 1,
              created_at: input.now.toISOString(),
              updated_at: input.now.toISOString(),
              deleted_at: null,
            },
            input.now,
          );
          await this.#privateEvent(
            userId,
            'personal_task_details_deleted',
            {
              course_task_id: input.sourceTaskId,
              revision: sourceDetails.revision + 1,
              deleted_at: input.now.toISOString(),
              reason: 'task_merge_conflict',
            },
            input.now,
          );
          if (sourceState !== undefined) {
            await this.#privateStateDeletedEvent(
              userId,
              input.sourceTaskId,
              sourceState.revision + 1,
              'task_merge_conflict',
              input.now,
            );
          }
          recovered += 1;
          continue;
        }
        await this.#client.query(
          `delete from personal_task_details
           where user_id = $1 and task_id = $2`,
          [userId, input.sourceTaskId],
        );
        await this.#privateEvent(
          userId,
          'personal_task_details_deleted',
          {
            course_task_id: input.sourceTaskId,
            revision: sourceDetails.revision + 1,
            deleted_at: input.now.toISOString(),
            reason: 'task_merge_duplicate',
          },
          input.now,
        );
      } else if (sourceDetails !== undefined) {
        const revision = sourceDetails.revision + 1;
        await this.#client.query(
          `update personal_task_details
           set task_id = $3, revision = $4, updated_at = $5
           where user_id = $1 and task_id = $2`,
          [
            userId,
            input.sourceTaskId,
            input.targetTaskId,
            revision,
            input.now,
          ],
        );
        await this.#privateEvent(
          userId,
          'personal_task_details_upserted',
          {
            course_task_id: input.targetTaskId,
            private_title: sourceDetails.private_title,
            private_deadline:
              sourceDetails.private_deadline?.toISOString() ?? null,
            private_note: sourceDetails.private_note,
            revision,
            created_at: sourceDetails.created_at.toISOString(),
            updated_at: input.now.toISOString(),
          },
          input.now,
        );
        await this.#privateEvent(
          userId,
          'personal_task_details_deleted',
          {
            course_task_id: input.sourceTaskId,
            revision,
            deleted_at: input.now.toISOString(),
            reason: 'task_merge_moved',
          },
          input.now,
        );
      }

      if (sourceState === undefined) continue;
      if (targetState === undefined) {
        const revision = sourceState.revision + 1;
        await this.#client.query(
          `update personal_task_states
           set task_id = $3, revision = $4, updated_at = $5
           where user_id = $1 and task_id = $2`,
          [
            userId,
            input.sourceTaskId,
            input.targetTaskId,
            revision,
            input.now,
          ],
        );
        await this.#privateStateEvent(
          userId,
          input.targetTaskId,
          sourceState.state,
          revision,
          sourceState.created_at,
          input.now,
        );
        await this.#privateStateDeletedEvent(
          userId,
          input.sourceTaskId,
          revision,
          'task_merge_moved',
          input.now,
        );
        continue;
      }
      const state = preferredState(targetState.state, sourceState.state);
      const revision = targetState.revision + 1;
      await this.#client.query(
        `update personal_task_states
         set state = $3, revision = $4, updated_at = $5
         where user_id = $1 and task_id = $2`,
        [userId, input.targetTaskId, state, revision, input.now],
      );
      await this.#client.query(
        `delete from personal_task_states
         where user_id = $1 and task_id = $2`,
        [userId, input.sourceTaskId],
      );
      await this.#privateStateEvent(
        userId,
        input.targetTaskId,
        state,
        revision,
        targetState.created_at,
        input.now,
      );
      await this.#privateStateDeletedEvent(
        userId,
        input.sourceTaskId,
        sourceState.revision + 1,
        'task_merge_merged',
        input.now,
      );
    }
    return recovered;
  }

  async #privateStateEvent(
    userId: string,
    taskId: string,
    state: PrivateStateRow['state'],
    revision: number,
    createdAt: Date,
    now: Date,
  ): Promise<void> {
    await this.#privateEvent(
      userId,
      'personal_task_state_upserted',
      {
        course_task_id: taskId,
        state,
        revision,
        created_at: createdAt.toISOString(),
        updated_at: now.toISOString(),
      },
      now,
    );
  }

  async #privateStateDeletedEvent(
    userId: string,
    taskId: string,
    revision: number,
    reason: PrivateDeletionReason,
    now: Date,
  ): Promise<void> {
    await this.#privateEvent(
      userId,
      'personal_task_state_deleted',
      {
        course_task_id: taskId,
        revision,
        deleted_at: now.toISOString(),
        reason,
      },
      now,
    );
  }

  async #privateEvent<Type extends PrivateEventDraft['type']>(
    userId: string,
    type: Type,
    payload: Extract<PrivateEventDraft, { type: Type }>['payload'],
    now: Date,
  ): Promise<void> {
    await this.#events.append({
      scope: 'private_user',
      userId,
      occurredAt: now,
      event: { type, payload } as PrivateEventDraft,
    });
  }

  async #mergeProposalVotes(input: {
    sourceProposalId: string;
    canonicalProposalId: string;
    classSectionId: string;
    now: Date;
  }): Promise<void> {
    const result = await this.#client.query<VoteRow & { proposal_id: string }>(
      `select user_id, proposal_id, direction, revision
       from accuracy_votes
       where proposal_id = any($1::uuid[])
       order by user_id, proposal_id
       for update`,
      [[input.canonicalProposalId, input.sourceProposalId]],
    );
    const canonicalVotes = new Map(
      result.rows
        .filter((vote) => vote.proposal_id === input.canonicalProposalId)
        .map((vote) => [vote.user_id, vote]),
    );
    for (const sourceVote of result.rows.filter(
      (vote) => vote.proposal_id === input.sourceProposalId,
    )) {
      const canonicalVote = canonicalVotes.get(sourceVote.user_id);
      if (sourceVote.direction === 'none') {
        await this.#deleteVote(sourceVote.user_id, input.sourceProposalId);
        continue;
      }
      if (canonicalVote === undefined) {
        const moved = await this.#client.query<{ revision: number }>(
          `update accuracy_votes
           set proposal_id = $2, revision = revision + 1, updated_at = $3
           where user_id = $1 and proposal_id = $4
           returning revision`,
          [
            sourceVote.user_id,
            input.canonicalProposalId,
            input.now,
            input.sourceProposalId,
          ],
        );
        const revision = moved.rows[0]?.revision;
        if (revision === undefined) throw new Error('Moved vote returned no row.');
        const vote = { ...sourceVote, revision };
        canonicalVotes.set(sourceVote.user_id, vote);
        await this.#voteEvent(
          sourceVote.user_id,
          input.canonicalProposalId,
          sourceVote.direction,
          revision,
          'task_merge_moved',
          input.now,
        );
        continue;
      }
      if (canonicalVote.direction === 'none') {
        const updated = await this.#client.query<{ revision: number }>(
          `update accuracy_votes
           set direction = $3, revision = revision + 1, updated_at = $4
           where user_id = $1 and proposal_id = $2
           returning revision`,
          [
            sourceVote.user_id,
            input.canonicalProposalId,
            sourceVote.direction,
            input.now,
          ],
        );
        await this.#deleteVote(sourceVote.user_id, input.sourceProposalId);
        const revision = updated.rows[0]?.revision;
        if (revision === undefined) throw new Error('Merged vote returned no row.');
        canonicalVotes.set(sourceVote.user_id, {
          ...canonicalVote,
          direction: sourceVote.direction,
          revision,
        });
        await this.#voteEvent(
          sourceVote.user_id,
          input.canonicalProposalId,
          sourceVote.direction,
          revision,
          'task_merge_moved',
          input.now,
        );
        continue;
      }
      await this.#deleteVote(sourceVote.user_id, input.sourceProposalId);
      if (canonicalVote.direction === sourceVote.direction) continue;

      const cleared = await this.#client.query<{ revision: number }>(
        `update accuracy_votes
         set direction = 'none', revision = revision + 1, updated_at = $3
         where user_id = $1 and proposal_id = $2
         returning revision`,
        [sourceVote.user_id, input.canonicalProposalId, input.now],
      );
      const revision = cleared.rows[0]?.revision;
      if (revision === undefined) throw new Error('Cleared vote returned no row.');
      canonicalVotes.set(sourceVote.user_id, {
        ...canonicalVote,
        direction: 'none',
        revision,
      });
      await this.#voteEvent(
        sourceVote.user_id,
        input.canonicalProposalId,
        'none',
        revision,
        'task_merge_conflict',
        input.now,
      );
    }
    await this.#recomputeTotals(input.canonicalProposalId, input.classSectionId, input.now);
    await this.#client.query(
      `insert into proposal_vote_totals (
         proposal_id, up, down, revision, updated_at
       ) values ($1, 0, 0, 1, $2)
       on conflict (proposal_id) do update
       set up = 0,
           down = 0,
           revision = proposal_vote_totals.revision + case
             when proposal_vote_totals.up <> 0 or proposal_vote_totals.down <> 0
             then 1 else 0 end,
           updated_at = excluded.updated_at`,
      [input.sourceProposalId, input.now],
    );
  }

  async #deleteVote(userId: string, proposalId: string): Promise<void> {
    await this.#client.query(
      `delete from accuracy_votes
       where user_id = $1 and proposal_id = $2`,
      [userId, proposalId],
    );
  }

  async #voteEvent(
    userId: string,
    proposalId: string,
    value: 'up' | 'down' | 'none',
    revision: number,
    reason: 'task_merge_conflict' | 'task_merge_moved',
    now: Date,
  ): Promise<void> {
    await this.#privateEvent(
      userId,
      'accuracy_vote_updated',
      {
        proposal_id: proposalId,
        value,
        revision,
        updated_at: now.toISOString(),
        reason,
      },
      now,
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
    const saved = await this.#client.query<{ revision: number }>(
      `insert into proposal_vote_totals (
         proposal_id, up, down, revision, updated_at
       ) values ($1, $2, $3, 1, $4)
       on conflict (proposal_id) do update
       set up = excluded.up,
           down = excluded.down,
           revision = proposal_vote_totals.revision + case
             when proposal_vote_totals.up is distinct from excluded.up
               or proposal_vote_totals.down is distinct from excluded.down
             then 1 else 0 end,
           updated_at = excluded.updated_at
       returning revision`,
      [proposalId, row.up, row.down, now],
    );
    const revision = saved.rows[0]?.revision;
    if (revision === undefined) throw new Error('Recomputed totals returned no row.');
    await this.#publicEvent(
      classSectionId,
      'proposal_vote_totals_updated',
      {
        proposal_id: proposalId,
        up: row.up,
        down: row.down,
        revision,
        updated_at: now.toISOString(),
      },
      now,
    );
  }

  async #publicEvent<Type extends PublicEventDraft['type']>(
    classSectionId: string,
    type: Type,
    payload: Extract<PublicEventDraft, { type: Type }>['payload'],
    now: Date,
  ): Promise<void> {
    await this.#events.append({
      scope: 'class_section_public',
      classSectionId,
      occurredAt: now,
      event: { type, payload } as PublicEventDraft,
    });
  }

  async #audit(input: {
    actorId: string;
    sourceTaskId: string;
    targetTaskId: string;
    reason: string;
    requestId: string;
    redirected: number;
    moved: number;
    recoveredPersonalTodos: number;
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
          recovered_personal_todos: input.recoveredPersonalTodos,
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


function requiredRow<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new Error('Task merge update returned no row.');
  }
  return row;
}

function sameDetails(
  left: PrivateDetailsRow,
  right: PrivateDetailsRow,
): boolean {
  return (
    left.private_title === right.private_title &&
    left.private_deadline?.getTime() === right.private_deadline?.getTime() &&
    left.private_note === right.private_note
  );
}

function preferredState(
  left: PrivateStateRow['state'],
  right: PrivateStateRow['state'],
): PrivateStateRow['state'] {
  const priority: Record<PrivateStateRow['state'], number> = {
    completed: 3,
    pending: 2,
    ignored: 1,
  };
  return priority[left] >= priority[right] ? left : right;
}

function conflict(message: string): HttpError {
  return new HttpError({ code: 'conflict', message, status: 409 });
}

function notFound(message: string): HttpError {
  return new HttpError({ code: 'not_found', message, status: 404 });
}
