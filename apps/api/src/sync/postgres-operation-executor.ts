import type { Client } from 'pg';

import {
  canonicalizeProposal,
  fingerprintProposal,
  type CanonicalProposal,
  type OperationEnvelope,
  type ProposalInput,
} from '@ddl-tracker/contracts';

import {
  SyncOperationRejection,
  type SyncOperationExecution,
} from './batch-service.js';

interface CommentRow {
  id: string;
  task_id: string;
  author_id: string | null;
  current_revision: number;
  body: string;
  moderation_state: 'visible' | 'hidden';
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface WritableTaskRow {
  id: string;
  class_section_id: string;
  visibility_state: 'visible' | 'hidden' | 'merged';
  term_status_override: 'active' | 'archived' | null;
  term_ends_on: string | null;
  section_active: boolean;
  course_active: boolean;
}

interface ProposalRow {
  id: string;
  task_id: string;
  author_id: string | null;
  title: string;
  deadline: Date;
  note: string | null;
  source_url: string | null;
  content_fingerprint: string;
  visibility_state: 'visible' | 'hidden' | 'redirected';
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface PersonalTaskDetailsRow {
  user_id: string;
  task_id: string;
  title: string;
  deadline: Date | null;
  note: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface PersonalTaskStateRow {
  user_id: string;
  task_id: string;
  state: 'pending' | 'completed' | 'ignored';
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface PersonalTodoRow {
  id: string;
  user_id: string;
  class_section_id: string | null;
  title: string;
  deadline: Date | null;
  note: string | null;
  state: 'pending' | 'completed' | 'ignored';
  revision: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function payloadRecord(operation: OperationEnvelope): Record<string, unknown> {
  if (Array.isArray(operation.payload)) {
    throw new Error('Validated operation payload is not an object.');
  }
  return operation.payload;
}

function stringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string') {
    throw new Error(`Validated operation field ${field} is not a string.`);
  }
  return value;
}

function nullableStringField(
  payload: Record<string, unknown>,
  field: string,
): string | null {
  const value = payload[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Validated operation field ${field} is not nullable text.`);
  }
  return value;
}

function integerField(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (!Number.isInteger(value)) {
    throw new Error(`Validated operation field ${field} is not an integer.`);
  }
  return value as number;
}

function proposalField(payload: Record<string, unknown>): CanonicalProposal {
  return canonicalizeProposal(payload.proposal as ProposalInput);
}

function shanghaiLocalDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('Unable to derive Asia/Shanghai date.');
  }
  return `${year}-${month}-${day}`;
}

function commentPayload(row: CommentRow) {
  return {
    id: row.id,
    course_task_id: row.task_id,
    author_id: row.author_id,
    body: row.body,
    revision: row.current_revision,
    moderation_state: row.moderation_state,
    deleted_at: row.deleted_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function proposalPayload(row: ProposalRow) {
  return {
    id: row.id,
    course_task_id: row.task_id,
    author_id: row.author_id,
    title: row.title,
    deadline: row.deadline.toISOString(),
    note: row.note,
    source_url: row.source_url,
    content_fingerprint: row.content_fingerprint,
    visibility_state: row.visibility_state,
    revision: requireRow(row).revision,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function integerFieldFrom(
  payload: Record<string, unknown>,
  fields: string[],
): number {
  for (const field of fields) {
    if (payload[field] !== undefined) {
      return integerField(payload, field);
    }
  }
  throw new Error(`Validated operation is missing ${fields.join(' or ')}.`);
}

function detailsPayload(row: PersonalTaskDetailsRow) {
  return {
    course_task_id: row.task_id,
    title: row.title,
    deadline: row.deadline?.toISOString() ?? null,
    note: row.note,
    revision: requireRow(row).revision,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function statePayload(row: PersonalTaskStateRow) {
  return {
    course_task_id: row.task_id,
    state: row.state,
    revision: requireRow(row).revision,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new Error('Expected database row was missing.');
  }
  return row;
}

function todoPayload(row: PersonalTodoRow) {
  return {
    id: row.id,
    class_section_id: row.class_section_id,
    title: row.title,
    deadline: row.deadline?.toISOString() ?? null,
    note: row.note,
    state: row.state,
    revision: requireRow(row).revision,
    deleted_at: row.deleted_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

export class PostgresStudentOperationExecutor {
  readonly #client: Client;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(
    client: Client,
    options: { now?: () => Date; createId: () => string },
  ) {
    this.#client = client;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId;
  }

  execute(
    userId: string,
    operation: OperationEnvelope,
  ): Promise<SyncOperationExecution> {
    switch (operation.type) {
      case 'follow_class_section':
        return this.#followClassSection(userId, payloadRecord(operation));
      case 'unfollow_class_section':
        return this.#unfollowClassSection(userId, payloadRecord(operation));
      case 'create_personal_todo':
        return this.#createPersonalTodo(userId, payloadRecord(operation));
      case 'update_personal_todo':
        return this.#updatePersonalTodo(userId, payloadRecord(operation));
      case 'delete_personal_todo':
        return this.#deletePersonalTodo(userId, payloadRecord(operation));
      case 'upsert_personal_task_details':
        return this.#upsertPersonalTaskDetails(userId, payloadRecord(operation));
      case 'delete_personal_task_details':
        return this.#deletePersonalTaskDetails(userId, payloadRecord(operation));
      case 'set_personal_task_state':
        return this.#setPersonalTaskState(userId, payloadRecord(operation));
      case 'merge_personal_todo_into_course_task':
        return this.#mergePersonalTodoIntoTask(userId, payloadRecord(operation));
      case 'publish_personal_todo_as_course_task':
        return this.#publishPersonalTodo(userId, payloadRecord(operation));
      case 'publish_personal_task_details_as_proposal':
        return this.#publishPersonalTaskDetails(userId, payloadRecord(operation));
      case 'create_course_task_with_initial_proposal':
        return this.#createCourseTask(userId, payloadRecord(operation));
      case 'create_task_proposal':
        return this.#createTaskProposal(userId, payloadRecord(operation));
      case 'set_accuracy_vote':
        return this.#setAccuracyVote(userId, payloadRecord(operation));
      case 'create_task_comment':
        return this.#createTaskComment(userId, payloadRecord(operation));
      case 'edit_task_comment':
        return this.#editTaskComment(userId, payloadRecord(operation));
      case 'delete_task_comment':
        return this.#deleteTaskComment(userId, payloadRecord(operation));
      case 'create_content_report':
        return this.#createContentReport(userId, payloadRecord(operation));
      default:
        throw new SyncOperationRejection({
          code: 'invalid_request',
          message: 'Operation type is not implemented.'
        });
    }
  }

  async #appendPublicEvent(
    classSectionId: string,
    type: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
  ): Promise<void> {
    await this.#client.query(
      `insert into sync_events (
         event_id, scope, class_section_id, type, schema_version, payload,
         occurred_at
       ) values ($1, 'class_section_public', $2, $3, 1, $4::jsonb, $5)`,
      [
        this.#createId(),
        classSectionId,
        type,
        JSON.stringify(payload),
        occurredAt,
      ],
    );
  }

  async #appendMaintainerEvent(
    type: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
  ): Promise<void> {
    await this.#client.query(
      `insert into sync_events (
         event_id, scope, type, schema_version, payload, occurred_at
       ) values ($1, 'maintainer_private', $2, 1, $3::jsonb, $4)`,
      [this.#createId(), type, JSON.stringify(payload), occurredAt],
    );
  }

  async #appendPrivateEvent(
    userId: string,
    type: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
  ): Promise<void> {
    await this.#client.query(
      `insert into sync_events (
         event_id, scope, scope_user_id, type, schema_version, payload,
         occurred_at
       ) values ($1, 'private_user', $2, $3, 1, $4::jsonb, $5)`,
      [this.#createId(), userId, type, JSON.stringify(payload), occurredAt],
    );
  }

  async #followClassSection(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const classSectionId = stringField(payload, 'class_section_id');
    const section = await this.#client.query(
      `select 1 from class_sections
       where id = $1 and active = true
       limit 1`,
      [classSectionId],
    );
    if (section.rowCount !== 1) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Class section not found.',
      });
    }
    const now = this.#now();
    const inserted = await this.#client.query(
      `insert into followed_class_sections (
         user_id, class_section_id, followed_at
       ) values ($1, $2, $3)
       on conflict (user_id, class_section_id) do nothing
       returning user_id`,
      [userId, classSectionId, now],
    );
    if (inserted.rowCount === 1) {
      await this.#appendPrivateEvent(
        userId,
        'class_section_followed',
        { class_section_id: classSectionId, followed_at: now.toISOString() },
        now,
      );
    }
    return { class_section_id: classSectionId, followed: true };
  }

  async #unfollowClassSection(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const classSectionId = stringField(payload, 'class_section_id');
    const deleted = await this.#client.query(
      `delete from followed_class_sections
       where user_id = $1 and class_section_id = $2
       returning user_id`,
      [userId, classSectionId],
    );
    if (deleted.rowCount === 1) {
      const now = this.#now();
      await this.#appendPrivateEvent(
        userId,
        'class_section_unfollowed',
        { class_section_id: classSectionId, unfollowed_at: now.toISOString() },
        now,
      );
    }
    return { class_section_id: classSectionId, followed: false };
  }

  async #createPersonalTodo(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const personalTodoId = stringField(payload, 'personal_todo_id');
    const classSectionId = nullableStringField(payload, 'class_section_id');
    const title = stringField(payload, 'title');
    const deadline = nullableStringField(payload, 'deadline');
    const note = nullableStringField(payload, 'note');
    const state = stringField(payload, 'state');
    const now = this.#now();
    let result;
    try {
      result = await this.#client.query<PersonalTodoRow>(
        `insert into personal_todos (
           id, user_id, class_section_id, title, deadline, note, state,
           revision, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8)
         returning id, user_id, class_section_id, title, deadline, note,
                   state, revision, deleted_at, created_at, updated_at`,
        [
          personalTodoId,
          userId,
          classSectionId,
          title,
          deadline,
          note,
          state,
          now,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SyncOperationRejection({
          code: 'conflict',
          message: 'Personal todo ID is already in use.',
        });
      }
      throw error;
    }
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Personal todo insert returned no row.');
    }
    await this.#appendPrivateEvent(
      userId,
      'personal_todo_upserted',
      todoPayload(requireRow(row)),
      now,
    );
    return { personal_todo_id: personalTodoId, revision: requireRow(row).revision };
  }

  async #updatePersonalTodo(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const personalTodoId = stringField(payload, 'personal_todo_id');
    const expectedRevision = integerField(payload, 'expected_revision');
    const now = this.#now();
    const updated = await this.#client.query<PersonalTodoRow>(
      `update personal_todos
       set class_section_id = $4, title = $5, deadline = $6, note = $7,
           state = $8, revision = revision + 1, updated_at = $9
       where id = $1 and user_id = $2 and revision = $3
         and deleted_at is null
       returning id, user_id, class_section_id, title, deadline, note,
                 state, revision, deleted_at, created_at, updated_at`,
      [
        personalTodoId,
        userId,
        expectedRevision,
        nullableStringField(payload, 'class_section_id'),
        stringField(payload, 'title'),
        nullableStringField(payload, 'deadline'),
        nullableStringField(payload, 'note'),
        stringField(payload, 'state'),
        now,
      ],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      await this.#throwTodoConflict(userId, personalTodoId, expectedRevision);
    }
    await this.#appendPrivateEvent(
      userId,
      'personal_todo_upserted',
      todoPayload(requireRow(row)),
      now,
    );
    return { personal_todo_id: personalTodoId, revision: requireRow(row).revision };
  }

  async #deletePersonalTodo(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const personalTodoId = stringField(payload, 'personal_todo_id');
    const expectedRevision = integerField(payload, 'expected_revision');
    const now = this.#now();
    const deleted = await this.#client.query<PersonalTodoRow>(
      `update personal_todos
       set revision = revision + 1, deleted_at = $4, updated_at = $4
       where id = $1 and user_id = $2 and revision = $3
         and deleted_at is null
       returning id, user_id, class_section_id, title, deadline, note,
                 state, revision, deleted_at, created_at, updated_at`,
      [personalTodoId, userId, expectedRevision, now],
    );
    const row = deleted.rows[0];
    if (row === undefined) {
      await this.#throwTodoConflict(userId, personalTodoId, expectedRevision);
    }
    await this.#appendPrivateEvent(
      userId,
      'personal_todo_deleted',
      {
        id: requireRow(row).id,
        revision: requireRow(row).revision,
        deleted_at: requireRow(row).deleted_at?.toISOString() ?? now.toISOString(),
      },
      now,
    );
    return {
      personal_todo_id: personalTodoId,
      revision: requireRow(row).revision,
      deleted: true,
    };
  }

  async #loadWritableClassSection(classSectionId: string): Promise<void> {
    const now = this.#now();
    const today = shanghaiLocalDate(now);
    const result = await this.#client.query<{
      section_active: boolean;
      course_active: boolean;
      status_override: 'active' | 'archived' | null;
      ends_on: string | null;
    }>(
      `select s.active as section_active, c.active as course_active,
              t.status_override, t.ends_on::text
       from class_sections s
       join courses c on c.id = s.course_id
       join academic_terms t on t.id = c.term_id
       where s.id = $1
       limit 1`,
      [classSectionId],
    );
    const row = result.rows[0];
    if (row === undefined || !row.section_active || !row.course_active) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Class section not found.',
      });
    }
    if (
      row.status_override === 'archived' ||
      (row.status_override !== 'active' &&
        row.ends_on !== null &&
        row.ends_on < today)
    ) {
      throw new SyncOperationRejection({
        code: 'inactive_term',
        message: 'The academic term is not writable.',
      });
    }
  }

  async #loadWritableTask(taskId: string): Promise<WritableTaskRow> {
    const result = await this.#client.query<WritableTaskRow>(
      `select ct.id, ct.class_section_id, ct.visibility_state,
              t.status_override as term_status_override,
              t.ends_on::text as term_ends_on,
              s.active as section_active,
              c.active as course_active
       from course_tasks ct
       join class_sections s on s.id = ct.class_section_id
       join courses c on c.id = s.course_id
       join academic_terms t on t.id = c.term_id
       where ct.id = $1
       limit 1`,
      [taskId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Course task not found.',
      });
    }
    if (row.visibility_state !== 'visible') {
      throw new SyncOperationRejection({
        code: 'content_hidden',
        message: 'Course task is not writable.',
      });
    }
    if (!row.section_active || !row.course_active) {
      throw new SyncOperationRejection({
        code: 'content_hidden',
        message: 'Course task is not writable.',
      });
    }
    const today = shanghaiLocalDate(this.#now());
    if (
      row.term_status_override === 'archived' ||
      (row.term_status_override !== 'active' &&
        row.term_ends_on !== null &&
        row.term_ends_on < today)
    ) {
      throw new SyncOperationRejection({
        code: 'inactive_term',
        message: 'The academic term is not writable.',
      });
    }
    return row;
  }

  async #insertProposal(input: {
    taskId: string;
    proposalId: string;
    authorId: string;
    proposal: CanonicalProposal;
    now: Date;
  }): Promise<ProposalRow> {
    const fingerprint = fingerprintProposal(input.proposal);
    try {
      const inserted = await this.#client.query<ProposalRow>(
        `insert into task_proposals (
           id, task_id, author_id, title, deadline, note, source_url,
           content_fingerprint, visibility_state, revision, created_at,
           updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8,
                   'visible', 1, $9, $9)
         returning id, task_id, author_id, title, deadline, note, source_url,
                   content_fingerprint, visibility_state, revision,
                   created_at, updated_at`,
        [
          input.proposalId,
          input.taskId,
          input.authorId,
          input.proposal.title,
          input.proposal.deadline,
          input.proposal.evidence_note,
          input.proposal.evidence_url,
          fingerprint,
          input.now,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) {
        throw new Error('Proposal insert returned no row.');
      }
      await this.#client.query(
        `insert into proposal_vote_totals (proposal_id, up, down, updated_at)
         values ($1, 0, 0, $2)`,
        [row.id, input.now],
      );
      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const duplicate = await this.#client.query<{ id: string }>(
        `select id from task_proposals
         where task_id = $1 and content_fingerprint = $2
         limit 1`,
        [input.taskId, fingerprint],
      );
      const existingId = duplicate.rows[0]?.id;
      if (existingId !== undefined) {
        throw new SyncOperationRejection({
          code: 'duplicate_proposal',
          message: 'An identical proposal already exists.',
          details: { existing_proposal_id: existingId },
        });
      }
      throw new SyncOperationRejection({
        code: 'conflict',
        message: 'Proposal ID is already in use.',
      });
    }
  }

  async #publishPersonalTodo(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const personalTodoId = stringField(payload, 'personal_todo_id');
    const expectedRevision = integerFieldFrom(payload, [
      'expected_personal_todo_revision',
      'expected_revision',
    ]);
    const classSectionId = stringField(payload, 'class_section_id');
    const current = await this.#client.query<PersonalTodoRow>(
      `select id, user_id, class_section_id, title, deadline, note, state,
              revision, deleted_at, created_at, updated_at
       from personal_todos
       where id = $1 and user_id = $2 and deleted_at is null
       for update`,
      [personalTodoId, userId],
    );
    const todo = current.rows[0];
    if (todo === undefined) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Personal todo not found.',
      });
    }
    if (todo.revision !== expectedRevision) {
      throw new SyncOperationRejection({
        code: 'revision_conflict',
        message: 'Personal todo revision does not match.',
        details: {
          expected_revision: expectedRevision,
          current_revision: todo.revision,
          current: todoPayload(todo),
        },
      });
    }
    if (
      todo.class_section_id !== null &&
      todo.class_section_id !== classSectionId
    ) {
      throw new SyncOperationRejection({
        code: 'conflict',
        message: 'Personal todo belongs to another class section.',
      });
    }
    const created = await this.#createCourseTask(userId, payload);
    const merged = await this.#mergePersonalTodoIntoTask(userId, {
      personal_todo_id: personalTodoId,
      course_task_id: stringField(payload, 'course_task_id'),
      expected_personal_todo_revision: expectedRevision,
    });
    return {
      ...created,
      ...merged,
      personal_todo_id: personalTodoId,
    };
  }

  async #publishPersonalTaskDetails(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const taskId = stringField(payload, 'course_task_id');
    const expectedRevision = integerFieldFrom(payload, [
      'expected_personal_task_details_revision',
      'expected_revision',
    ]);
    const current = await this.#client.query<PersonalTaskDetailsRow>(
      `select user_id, task_id, title, deadline, note, revision,
              created_at, updated_at
       from personal_task_details
       where user_id = $1 and task_id = $2
       for update`,
      [userId, taskId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Personal task details not found.',
      });
    }
    if (row.revision !== expectedRevision) {
      throw new SyncOperationRejection({
        code: 'revision_conflict',
        message: 'Personal task details revision does not match.',
        details: {
          expected_revision: expectedRevision,
          current_revision: requireRow(row).revision,
          current: detailsPayload(row),
        },
      });
    }
    return this.#createTaskProposal(userId, payload);
  }

  async #createCourseTask(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const taskId = stringField(payload, 'course_task_id');
    const classSectionId = stringField(payload, 'class_section_id');
    const proposalId = stringField(payload, 'proposal_id');
    const proposal = proposalField(payload);
    await this.#loadWritableClassSection(classSectionId);
    const now = this.#now();
    try {
      await this.#client.query(
        `insert into course_tasks (
           id, class_section_id, created_by, visibility_state, revision,
           created_at, updated_at
         ) values ($1, $2, $3, 'visible', 1, $4, $4)`,
        [taskId, classSectionId, userId, now],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SyncOperationRejection({
          code: 'conflict',
          message: 'Course task ID is already in use.',
        });
      }
      throw error;
    }
    const row = await this.#insertProposal({
      taskId,
      proposalId,
      authorId: userId,
      proposal,
      now,
    });
    await this.#client.query(
      `insert into accuracy_votes (
         user_id, proposal_id, direction, created_at, updated_at
       ) values ($1, $2, 'up', $3, $3)`,
      [userId, proposalId, now],
    );
    await this.#client.query(
      `update proposal_vote_totals
       set up = 1, down = 0, updated_at = $2
       where proposal_id = $1`,
      [proposalId, now],
    );
    await this.#appendPublicEvent(
      classSectionId,
      'course_task_created',
      {
        id: taskId,
        class_section_id: classSectionId,
        created_by: userId,
        visibility_state: 'visible',
        revision: 1,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      now,
    );
    await this.#appendPublicEvent(
      classSectionId,
      'task_proposal_created',
      proposalPayload(row),
      now,
    );
    await this.#appendPublicEvent(
      classSectionId,
      'proposal_vote_totals_updated',
      { proposal_id: proposalId, up: 1, down: 0, updated_at: now.toISOString() },
      now,
    );
    await this.#appendPrivateEvent(
      userId,
      'accuracy_vote_updated',
      { proposal_id: proposalId, value: 'up', updated_at: now.toISOString() },
      now,
    );
    return {
      course_task_id: taskId,
      proposal_id: proposalId,
      vote: 'up',
    };
  }

  async #createTaskProposal(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const taskId = stringField(payload, 'course_task_id');
    const proposalId = stringField(payload, 'proposal_id');
    const task = await this.#loadWritableTask(taskId);
    const now = this.#now();
    const row = await this.#insertProposal({
      taskId,
      proposalId,
      authorId: userId,
      proposal: proposalField(payload),
      now,
    });
    await this.#appendPublicEvent(
      task.class_section_id,
      'task_proposal_created',
      proposalPayload(row),
      now,
    );
    await this.#appendPublicEvent(
      task.class_section_id,
      'proposal_vote_totals_updated',
      { proposal_id: proposalId, up: 0, down: 0, updated_at: now.toISOString() },
      now,
    );
    return { course_task_id: taskId, proposal_id: proposalId };
  }

  async #setAccuracyVote(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const proposalId = stringField(payload, 'proposal_id');
    const value = stringField(payload, 'value');
    const proposal = await this.#client.query<{
      id: string;
      visibility_state: 'visible' | 'hidden' | 'redirected';
      task_id: string;
    }>(
      `select id, visibility_state, task_id
       from task_proposals where id = $1 limit 1`,
      [proposalId],
    );
    const proposalRow = proposal.rows[0];
    if (proposalRow === undefined) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Proposal not found.',
      });
    }
    if (proposalRow.visibility_state !== 'visible') {
      throw new SyncOperationRejection({
        code: 'content_hidden',
        message: 'Proposal is not writable.',
      });
    }
    const task = await this.#loadWritableTask(proposalRow.task_id);
    const now = this.#now();
    if (value === 'none') {
      await this.#client.query(
        `delete from accuracy_votes
         where user_id = $1 and proposal_id = $2`,
        [userId, proposalId],
      );
    } else {
      await this.#client.query(
        `insert into accuracy_votes (
           user_id, proposal_id, direction, created_at, updated_at
         ) values ($1, $2, $3, $4, $4)
         on conflict (user_id, proposal_id) do update
         set direction = excluded.direction, updated_at = excluded.updated_at`,
        [userId, proposalId, value, now],
      );
    }
    const counts = await this.#client.query<{ up: string; down: string }>(
      `select
         count(*) filter (where direction = 'up')::text as up,
         count(*) filter (where direction = 'down')::text as down
       from accuracy_votes
       where proposal_id = $1`,
      [proposalId],
    );
    const up = Number(counts.rows[0]?.up ?? '0');
    const down = Number(counts.rows[0]?.down ?? '0');
    await this.#client.query(
      `update proposal_vote_totals
       set up = $2, down = $3, updated_at = $4
       where proposal_id = $1`,
      [proposalId, up, down, now],
    );
    await this.#appendPublicEvent(
      task.class_section_id,
      'proposal_vote_totals_updated',
      { proposal_id: proposalId, up, down, updated_at: now.toISOString() },
      now,
    );
    await this.#appendPrivateEvent(
      userId,
      'accuracy_vote_updated',
      { proposal_id: proposalId, value, updated_at: now.toISOString() },
      now,
    );
    return { proposal_id: proposalId, value, up, down };
  }

  async #loadOwnedComment(
    userId: string,
    commentId: string,
  ): Promise<{ row: CommentRow; classSectionId: string }> {
    const result = await this.#client.query<CommentRow & {
      class_section_id: string;
    }>(
      `select tc.id, tc.task_id, tc.author_id, tc.current_revision,
              cr.body, tc.moderation_state, tc.deleted_at, tc.created_at,
              tc.updated_at, ct.class_section_id
       from task_comments tc
       join course_tasks ct on ct.id = tc.task_id
       join comment_revisions cr
         on cr.comment_id = tc.id and cr.revision = tc.current_revision
       where tc.id = $1 and tc.author_id = $2
       limit 1`,
      [commentId, userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Comment not found.',
      });
    }
    return { row, classSectionId: row.class_section_id };
  }

  async #createTaskComment(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const commentId = stringField(payload, 'comment_id');
    const taskId = stringField(payload, 'course_task_id');
    const body = stringField(payload, 'body');
    const task = await this.#loadWritableTask(taskId);
    const now = this.#now();
    try {
      await this.#client.query(
        `insert into task_comments (
           id, task_id, author_id, current_revision, moderation_state,
           created_at, updated_at
         ) values ($1, $2, $3, 1, 'visible', $4, $4)`,
        [commentId, taskId, userId, now],
      );
      await this.#client.query(
        `insert into comment_revisions (
           comment_id, revision, body, author_id, created_at
         ) values ($1, 1, $2, $3, $4)`,
        [commentId, body, userId, now],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SyncOperationRejection({
          code: 'conflict',
          message: 'Comment ID is already in use.',
        });
      }
      throw error;
    }
    const row: CommentRow = {
      id: commentId,
      task_id: taskId,
      author_id: userId,
      current_revision: 1,
      body,
      moderation_state: 'visible',
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    await this.#appendPublicEvent(
      task.class_section_id,
      'task_comment_upserted',
      commentPayload(row),
      now,
    );
    return { comment_id: commentId, revision: 1 };
  }

  async #editTaskComment(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const commentId = stringField(payload, 'comment_id');
    const expectedRevision = integerField(payload, 'expected_revision');
    const body = stringField(payload, 'body');
    const current = await this.#loadOwnedComment(userId, commentId);
    if (current.row.deleted_at !== null) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Comment not found.',
      });
    }
    if (current.row.moderation_state !== 'visible') {
      throw new SyncOperationRejection({
        code: 'content_hidden',
        message: 'Comment is not editable.',
      });
    }
    if (current.row.current_revision !== expectedRevision) {
      throw new SyncOperationRejection({
        code: 'revision_conflict',
        message: 'Comment revision does not match.',
        details: {
          expected_revision: expectedRevision,
          current_revision: current.row.current_revision,
          current: commentPayload(current.row),
        },
      });
    }
    const now = this.#now();
    const nextRevision = expectedRevision + 1;
    await this.#client.query(
      `insert into comment_revisions (
         comment_id, revision, body, author_id, created_at
       ) values ($1, $2, $3, $4, $5)`,
      [commentId, nextRevision, body, userId, now],
    );
    await this.#client.query(
      `update task_comments
       set current_revision = $3, updated_at = $4
       where id = $1 and author_id = $2 and current_revision = $5`,
      [commentId, userId, nextRevision, now, expectedRevision],
    );
    const row: CommentRow = {
      ...current.row,
      current_revision: nextRevision,
      body,
      updated_at: now,
    };
    await this.#appendPublicEvent(
      current.classSectionId,
      'task_comment_upserted',
      commentPayload(row),
      now,
    );
    return { comment_id: commentId, revision: nextRevision };
  }

  async #deleteTaskComment(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const commentId = stringField(payload, 'comment_id');
    const expectedRevision = integerField(payload, 'expected_revision');
    const current = await this.#loadOwnedComment(userId, commentId);
    if (current.row.deleted_at !== null) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Comment not found.',
      });
    }
    if (current.row.current_revision !== expectedRevision) {
      throw new SyncOperationRejection({
        code: 'revision_conflict',
        message: 'Comment revision does not match.',
        details: {
          expected_revision: expectedRevision,
          current_revision: current.row.current_revision,
          current: commentPayload(current.row),
        },
      });
    }
    const now = this.#now();
    const nextRevision = expectedRevision + 1;
    const updated = await this.#client.query(
      `update task_comments
       set current_revision = $3, deleted_at = $4, updated_at = $4
       where id = $1 and author_id = $2 and current_revision = $5
         and deleted_at is null
       returning id`,
      [commentId, userId, nextRevision, now, expectedRevision],
    );
    if (updated.rowCount !== 1) {
      throw new SyncOperationRejection({
        code: 'revision_conflict',
        message: 'Comment changed while being deleted.',
      });
    }
    await this.#appendPublicEvent(
      current.classSectionId,
      'task_comment_deleted',
      {
        id: commentId,
        course_task_id: current.row.task_id,
        revision: nextRevision,
        deleted_at: now.toISOString(),
      },
      now,
    );
    return { comment_id: commentId, revision: nextRevision, deleted: true };
  }

  async #assertReportTarget(
    targetType: string,
    targetId: string,
  ): Promise<void> {
    const queries: Record<string, string> = {
      course_task:
        `select 1 from course_tasks where id = $1 and visibility_state <> 'merged' limit 1`,
      proposal:
        `select 1 from task_proposals where id = $1 and visibility_state <> 'redirected' limit 1`,
      comment:
        `select 1 from task_comments where id = $1 and deleted_at is null limit 1`,
      user: `select 1 from users where id = $1 and status <> 'deleted' limit 1`,
    };
    const query = queries[targetType];
    if (query === undefined) {
      throw new Error('Validated report target type is unsupported.');
    }
    const result = await this.#client.query(query, [targetId]);
    if (result.rowCount !== 1) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Report target not found.',
      });
    }
  }

  async #createContentReport(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const reportId = stringField(payload, 'report_id');
    const targetType = stringField(payload, 'target_type');
    const targetId = stringField(payload, 'target_id');
    const reason = stringField(payload, 'reason');
    const details = nullableStringField(payload, 'details');
    await this.#assertReportTarget(targetType, targetId);
    const now = this.#now();
    try {
      await this.#client.query(
        `insert into content_reports (
           id, reporter_id, target_type, target_id, reason, details, status,
           created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, 'open', $7, $7)`,
        [reportId, userId, targetType, targetId, reason, details, now],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SyncOperationRejection({
          code: 'conflict',
          message: 'Report ID is already in use.',
        });
      }
      throw error;
    }
    const reporterPayload = {
      report_id: reportId,
      target_type: targetType,
      target_id: targetId,
      reason,
      status: 'open',
      created_at: now.toISOString(),
    };
    await this.#appendPrivateEvent(
      userId,
      'content_report_status_updated',
      reporterPayload,
      now,
    );
    await this.#appendMaintainerEvent(
      'content_report_status_updated',
      { ...reporterPayload, reporter_id: userId, details },
      now,
    );
    return { report_id: reportId, status: 'open' };
  }

  async #assertTaskExists(taskId: string): Promise<void> {
    const task = await this.#client.query(
      `select 1 from course_tasks
       where id = $1 and visibility_state <> 'merged'
       limit 1`,
      [taskId],
    );
    if (task.rowCount !== 1) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Course task not found.',
      });
    }
  }

  async #upsertPersonalTaskDetails(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const taskId = stringField(payload, 'course_task_id');
    const expectedRevision = integerField(payload, 'expected_revision');
    await this.#assertTaskExists(taskId);
    const now = this.#now();
    let row: PersonalTaskDetailsRow | undefined;
    if (expectedRevision === 0) {
      try {
        const inserted = await this.#client.query<PersonalTaskDetailsRow>(
          `insert into personal_task_details (
             user_id, task_id, title, deadline, note, revision,
             created_at, updated_at
           ) values ($1, $2, $3, $4, $5, 1, $6, $6)
           returning user_id, task_id, title, deadline, note, revision,
                     created_at, updated_at`,
          [
            userId,
            taskId,
            stringField(payload, 'title'),
            nullableStringField(payload, 'deadline'),
            nullableStringField(payload, 'note'),
            now,
          ],
        );
        row = inserted.rows[0];
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    } else {
      const updated = await this.#client.query<PersonalTaskDetailsRow>(
        `update personal_task_details
         set title = $4, deadline = $5, note = $6,
             revision = revision + 1, updated_at = $7
         where user_id = $1 and task_id = $2 and revision = $3
         returning user_id, task_id, title, deadline, note, revision,
                   created_at, updated_at`,
        [
          userId,
          taskId,
          expectedRevision,
          stringField(payload, 'title'),
          nullableStringField(payload, 'deadline'),
          nullableStringField(payload, 'note'),
          now,
        ],
      );
      row = updated.rows[0];
    }
    if (row === undefined) {
      await this.#throwDetailsConflict(userId, taskId, expectedRevision);
    }
    await this.#appendPrivateEvent(
      userId,
      'personal_task_details_upserted',
      detailsPayload(requireRow(row)),
      now,
    );
    return { course_task_id: taskId, revision: requireRow(row).revision };
  }

  async #deletePersonalTaskDetails(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const taskId = stringField(payload, 'course_task_id');
    const expectedRevision = integerField(payload, 'expected_revision');
    const deleted = await this.#client.query<PersonalTaskDetailsRow>(
      `delete from personal_task_details
       where user_id = $1 and task_id = $2 and revision = $3
       returning user_id, task_id, title, deadline, note, revision,
                 created_at, updated_at`,
      [userId, taskId, expectedRevision],
    );
    const row = deleted.rows[0];
    if (row === undefined) {
      await this.#throwDetailsConflict(userId, taskId, expectedRevision);
    }
    const now = this.#now();
    const nextRevision = requireRow(row).revision + 1;
    await this.#appendPrivateEvent(
      userId,
      'personal_task_details_deleted',
      {
        course_task_id: taskId,
        revision: nextRevision,
        deleted_at: now.toISOString(),
      },
      now,
    );
    return { course_task_id: taskId, revision: nextRevision, deleted: true };
  }

  async #setPersonalTaskState(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const taskId = stringField(payload, 'course_task_id');
    const expectedRevision = integerField(payload, 'expected_revision');
    const state = stringField(payload, 'state');
    await this.#assertTaskExists(taskId);
    const now = this.#now();
    let row: PersonalTaskStateRow | undefined;
    if (expectedRevision === 0) {
      try {
        const inserted = await this.#client.query<PersonalTaskStateRow>(
          `insert into personal_task_states (
             user_id, task_id, state, revision, created_at, updated_at
           ) values ($1, $2, $3, 1, $4, $4)
           returning user_id, task_id, state, revision, created_at, updated_at`,
          [userId, taskId, state, now],
        );
        row = inserted.rows[0];
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    } else {
      const updated = await this.#client.query<PersonalTaskStateRow>(
        `update personal_task_states
         set state = $4, revision = revision + 1, updated_at = $5
         where user_id = $1 and task_id = $2 and revision = $3
         returning user_id, task_id, state, revision, created_at, updated_at`,
        [userId, taskId, expectedRevision, state, now],
      );
      row = updated.rows[0];
    }
    if (row === undefined) {
      await this.#throwStateConflict(userId, taskId, expectedRevision);
    }
    await this.#appendPrivateEvent(
      userId,
      'personal_task_state_upserted',
      statePayload(requireRow(row)),
      now,
    );
    return {
      course_task_id: taskId,
      revision: requireRow(row).revision,
      state: requireRow(row).state,
    };
  }

  async #mergePersonalTodoIntoTask(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<SyncOperationExecution> {
    const personalTodoId = stringField(payload, 'personal_todo_id');
    const taskId = stringField(payload, 'course_task_id');
    const expectedRevision = integerFieldFrom(payload, [
      'expected_personal_todo_revision',
      'expected_revision',
    ]);
    await this.#assertTaskExists(taskId);
    const todoResult = await this.#client.query<PersonalTodoRow>(
      `select id, user_id, class_section_id, title, deadline, note, state,
              revision, deleted_at, created_at, updated_at
       from personal_todos
       where id = $1 and user_id = $2 and deleted_at is null
       for update`,
      [personalTodoId, userId],
    );
    const todo = todoResult.rows[0];
    if (todo === undefined) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Personal todo not found.',
      });
    }
    if (todo.revision !== expectedRevision) {
      throw new SyncOperationRejection({
        code: 'revision_conflict',
        message: 'Personal todo revision does not match.',
        details: {
          expected_revision: expectedRevision,
          current_revision: todo.revision,
          current: todoPayload(todo),
        },
      });
    }
    const now = this.#now();
    const details = await this.#client.query<PersonalTaskDetailsRow>(
      `insert into personal_task_details (
         user_id, task_id, title, deadline, note, revision,
         created_at, updated_at
       ) values ($1, $2, $3, $4, $5, 1, $6, $6)
       on conflict (user_id, task_id) do update
       set title = excluded.title, deadline = excluded.deadline,
           note = excluded.note,
           revision = personal_task_details.revision + 1,
           updated_at = excluded.updated_at
       returning user_id, task_id, title, deadline, note, revision,
                 created_at, updated_at`,
      [userId, taskId, todo.title, todo.deadline, todo.note, now],
    );
    const state = await this.#client.query<PersonalTaskStateRow>(
      `insert into personal_task_states (
         user_id, task_id, state, revision, created_at, updated_at
       ) values ($1, $2, $3, 1, $4, $4)
       on conflict (user_id, task_id) do update
       set state = excluded.state,
           revision = personal_task_states.revision + 1,
           updated_at = excluded.updated_at
       returning user_id, task_id, state, revision, created_at, updated_at`,
      [userId, taskId, todo.state, now],
    );
    const deleted = await this.#client.query<PersonalTodoRow>(
      `update personal_todos
       set revision = revision + 1, deleted_at = $4, updated_at = $4
       where id = $1 and user_id = $2 and revision = $3
       returning id, user_id, class_section_id, title, deadline, note, state,
                 revision, deleted_at, created_at, updated_at`,
      [personalTodoId, userId, expectedRevision, now],
    );
    const detailsRow = details.rows[0];
    const stateRow = state.rows[0];
    const deletedTodo = deleted.rows[0];
    if (
      detailsRow === undefined ||
      stateRow === undefined ||
      deletedTodo === undefined
    ) {
      throw new Error('Personal todo merge did not return all records.');
    }
    await this.#appendPrivateEvent(
      userId,
      'personal_task_details_upserted',
      detailsPayload(detailsRow),
      now,
    );
    await this.#appendPrivateEvent(
      userId,
      'personal_task_state_upserted',
      statePayload(stateRow),
      now,
    );
    await this.#appendPrivateEvent(
      userId,
      'personal_todo_deleted',
      {
        id: deletedTodo.id,
        revision: deletedTodo.revision,
        deleted_at: deletedTodo.deleted_at?.toISOString() ?? now.toISOString(),
      },
      now,
    );
    return {
      personal_todo_id: personalTodoId,
      course_task_id: taskId,
      personal_todo_revision: deletedTodo.revision,
      personal_task_details_revision: detailsRow.revision,
      personal_task_state_revision: stateRow.revision,
    };
  }

  async #throwDetailsConflict(
    userId: string,
    taskId: string,
    expectedRevision: number,
  ): Promise<never> {
    const current = await this.#client.query<PersonalTaskDetailsRow>(
      `select user_id, task_id, title, deadline, note, revision,
              created_at, updated_at
       from personal_task_details
       where user_id = $1 and task_id = $2
       limit 1`,
      [userId, taskId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      if (expectedRevision === 0) {
        throw new SyncOperationRejection({
          code: 'revision_conflict',
          message: 'Personal task details no longer match expected absence.',
          details: { expected_revision: 0, current_revision: 0 },
        });
      }
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Personal task details not found.',
      });
    }
    throw new SyncOperationRejection({
      code: 'revision_conflict',
      message: 'Personal task details revision does not match.',
      details: {
        expected_revision: expectedRevision,
        current_revision: requireRow(row).revision,
        current: detailsPayload(row),
      },
    });
  }

  async #throwStateConflict(
    userId: string,
    taskId: string,
    expectedRevision: number,
  ): Promise<never> {
    const current = await this.#client.query<PersonalTaskStateRow>(
      `select user_id, task_id, state, revision, created_at, updated_at
       from personal_task_states
       where user_id = $1 and task_id = $2
       limit 1`,
      [userId, taskId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      if (expectedRevision === 0) {
        throw new SyncOperationRejection({
          code: 'revision_conflict',
          message: 'Personal task state no longer matches expected absence.',
          details: { expected_revision: 0, current_revision: 0 },
        });
      }
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Personal task state not found.',
      });
    }
    throw new SyncOperationRejection({
      code: 'revision_conflict',
      message: 'Personal task state revision does not match.',
      details: {
        expected_revision: expectedRevision,
        current_revision: requireRow(row).revision,
        current: statePayload(row),
      },
    });
  }

  async #throwTodoConflict(
    userId: string,
    personalTodoId: string,
    expectedRevision: number,
  ): Promise<never> {
    const current = await this.#client.query<PersonalTodoRow>(
      `select id, user_id, class_section_id, title, deadline, note, state,
              revision, deleted_at, created_at, updated_at
       from personal_todos
       where id = $1 and user_id = $2
       limit 1`,
      [personalTodoId, userId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      throw new SyncOperationRejection({
        code: 'not_found',
        message: 'Personal todo not found.',
      });
    }
    throw new SyncOperationRejection({
      code: 'revision_conflict',
      message: 'Personal todo revision does not match.',
      details: {
        expected_revision: expectedRevision,
        current_revision: requireRow(row).revision,
        current: todoPayload(row),
      },
    });
  }
}
