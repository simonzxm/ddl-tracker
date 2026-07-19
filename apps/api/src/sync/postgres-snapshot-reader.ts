import type { Client } from 'pg';

import { HttpError } from '../http/errors.js';

export interface SnapshotRecord {
  record_type: string;
  id: string;
  payload: Record<string, unknown>;
}

export interface SnapshotAfter {
  recordType: string;
  id: string;
}

export interface SnapshotPage {
  records: SnapshotRecord[];
  complete: boolean;
  nextAfter: SnapshotAfter | null;
}

interface TaskRow {
  id: string;
  class_section_id: string;
  created_by: string | null;
  state: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface ProposalRow {
  id: string;
  task_id: string;
  author_id: string | null;
  title: string;
  deadline: Date;
  description: string | null;
  evidence_note: string | null;
  evidence_url: string | null;
  content_fingerprint: string;
  state: string;
  revision: number;
  created_at: Date;
}

interface CommentRow {
  id: string;
  task_id: string;
  author_id: string | null;
  current_revision: number;
  body: string | null;
  state: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function compareKey(
  left: Pick<SnapshotRecord, 'record_type' | 'id'>,
  right: Pick<SnapshotRecord, 'record_type' | 'id'>,
): number {
  if (left.record_type < right.record_type) return -1;
  if (left.record_type > right.record_type) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function afterKey(record: SnapshotRecord, after: SnapshotAfter): boolean {
  return compareKey(record, {
    record_type: after.recordType,
    id: after.id,
  }) > 0;
}

function paginate(
  records: SnapshotRecord[],
  after: SnapshotAfter | null,
  limit: number,
): SnapshotPage {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Invalid snapshot page limit.');
  }
  const sorted = [...records].sort(compareKey);
  const remaining = after === null ? sorted : sorted.filter((record) => afterKey(record, after));
  const selected = remaining.slice(0, limit);
  const complete = remaining.length <= limit;
  const last = selected.at(-1);
  return {
    records: selected,
    complete,
    nextAfter:
      complete || last === undefined
        ? null
        : { recordType: last.record_type, id: last.id },
  };
}

function date(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export class PostgresSnapshotReader {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async readAnchor(): Promise<number> {
    const result = await this.#client.query<{ sequence: string }>(
      `select coalesce(max(sequence), 0)::text as sequence from sync_events`,
    );
    const sequence = Number(result.rows[0]?.sequence ?? '0');
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error('Sync snapshot anchor exceeds safe integer range.');
    }
    return sequence;
  }

  async readAccountPage(input: {
    userId: string;
    after: SnapshotAfter | null;
    limit: number;
  }): Promise<SnapshotPage> {
    const records: SnapshotRecord[] = [];
    await this.#appendUserProfile(records, input.userId, 'public_user_profile');

    const follows = await this.#client.query<{
      class_section_id: string;
      created_at: Date;
    }>(
      `select class_section_id, created_at
       from followed_class_sections
       where user_id = $1`,
      [input.userId],
    );
    for (const row of follows.rows) {
      records.push({
        record_type: 'followed_class_section',
        id: row.class_section_id,
        payload: {
          class_section_id: row.class_section_id,
          followed_at: row.created_at.toISOString(),
        },
      });
    }

    const todos = await this.#client.query<{
      id: string;
      class_section_id: string | null;
      title: string;
      deadline: Date | null;
      note: string | null;
      state: string;
      revision: number;
      deleted_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, class_section_id, title, deadline, note, state, revision,
              deleted_at, created_at, updated_at
       from personal_todos
       where user_id = $1`,
      [input.userId],
    );
    for (const row of todos.rows) {
      records.push({
        record_type: 'personal_todo',
        id: row.id,
        payload: {
          id: row.id,
          class_section_id: row.class_section_id,
          title: row.title,
          deadline: date(row.deadline),
          note: row.note,
          state: row.state,
          revision: row.revision,
          deleted_at: date(row.deleted_at),
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        },
      });
    }

    await this.#appendPrivateTaskRecords(records, input.userId, null);
    await this.#appendSharedSectionRecords(
      records,
      input.userId,
      follows.rows.map(({ class_section_id }) => class_section_id),
    );
    return paginate(records, input.after, input.limit);
  }

  async readClassSectionPage(input: {
    userId: string;
    classSectionId: string;
    after: SnapshotAfter | null;
    limit: number;
  }): Promise<SnapshotPage> {
    const section = await this.#client.query<{
      id: string;
      course_id: string;
      external_section_id: string;
      section_number: string;
      instructors: unknown;
      campus: string | null;
      capacity: number | null;
      schedule_text: string | null;
      active: boolean;
      revision: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, course_id, external_section_id, section_number,
              instructors, campus, capacity, schedule_text,
              active, revision, created_at, updated_at
       from class_sections
       where id = $1 and active = true
       limit 1`,
      [input.classSectionId],
    );
    const row = section.rows[0];
    if (row === undefined) {
      throw new HttpError({
        code: 'not_found',
        message: 'Class section not found.',
        status: 404,
      });
    }
    const records: SnapshotRecord[] = [
      {
        record_type: 'class_section',
        id: row.id,
        payload: {
          id: row.id,
          course_id: row.course_id,
          external_section_id: row.external_section_id,
          section_number: row.section_number,
          instructors: row.instructors,
          campus: row.campus,
          capacity: row.capacity,
          schedule_text: row.schedule_text,
          active: row.active,
          revision: row.revision,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        },
      },
    ];
    await this.#appendPrivateTaskRecords(
      records,
      input.userId,
      input.classSectionId,
    );
    await this.#appendSharedSectionRecords(records, input.userId, [input.classSectionId]);
    return paginate(records, input.after, input.limit);
  }

  async #appendUserProfile(
    records: SnapshotRecord[],
    userId: string,
    recordType: string,
  ): Promise<void> {
    const result = await this.#client.query<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      bio: string | null;
      status: string;
      profile_revision: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, username, display_name, avatar_url, bio, status,
              profile_revision, created_at, updated_at
       from users where id = $1 and status <> 'deleted' limit 1`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) return;
    records.push({
      record_type: recordType,
      id: row.id,
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
    });
  }

  async #appendPrivateTaskRecords(
    records: SnapshotRecord[],
    userId: string,
    classSectionId: string | null,
  ): Promise<void> {
    const sectionPredicate =
      classSectionId === null
        ? ''
        : ' and exists (select 1 from course_tasks ct where ct.id = d.task_id and ct.class_section_id = $2)';
    const details = await this.#client.query<{
      task_id: string;
      private_title: string | null;
      private_deadline: Date | null;
      private_note: string | null;
      revision: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `select d.task_id, d.private_title, d.private_deadline, d.private_note, d.revision,
              d.created_at, d.updated_at
       from personal_task_details d
       where d.user_id = $1${sectionPredicate}`,
      classSectionId === null ? [userId] : [userId, classSectionId],
    );
    for (const row of details.rows) {
      records.push({
        record_type: 'personal_task_details',
        id: row.task_id,
        payload: {
          course_task_id: row.task_id,
          private_title: row.private_title,
          private_deadline: date(row.private_deadline),
          private_note: row.private_note,
          revision: row.revision,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        },
      });
    }

    const statePredicate =
      classSectionId === null
        ? ''
        : ' and exists (select 1 from course_tasks ct where ct.id = s.task_id and ct.class_section_id = $2)';
    const states = await this.#client.query<{
      task_id: string;
      state: string;
      revision: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `select s.task_id, s.state, s.revision, s.created_at, s.updated_at
       from personal_task_states s
       where s.user_id = $1${statePredicate}`,
      classSectionId === null ? [userId] : [userId, classSectionId],
    );
    for (const row of states.rows) {
      records.push({
        record_type: 'personal_task_state',
        id: row.task_id,
        payload: {
          course_task_id: row.task_id,
          state: row.state,
          revision: row.revision,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        },
      });
    }
  }

  async #appendSharedSectionRecords(
    records: SnapshotRecord[],
    userId: string,
    classSectionIds: string[],
  ): Promise<void> {
    if (classSectionIds.length === 0) return;
    const sections = await this.#client.query<{
      id: string;
      course_id: string;
      external_section_id: string;
      section_number: string;
      instructors: unknown;
      campus: string | null;
      capacity: number | null;
      schedule_text: string | null;
      active: boolean;
      revision: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, course_id, external_section_id, section_number,
              instructors, campus, capacity, schedule_text,
              active, revision, created_at, updated_at
       from class_sections where id = any($1::uuid[])`,
      [classSectionIds],
    );
    for (const row of sections.rows) {
      if (
        records.some(
          (record) =>
            record.record_type === 'class_section' && record.id === row.id,
        )
      ) {
        continue;
      }
      records.push({
        record_type: 'class_section',
        id: row.id,
        payload: {
          id: row.id,
          course_id: row.course_id,
          external_section_id: row.external_section_id,
          section_number: row.section_number,
          instructors: row.instructors,
          campus: row.campus,
          capacity: row.capacity,
          schedule_text: row.schedule_text,
          active: row.active,
          revision: row.revision,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        },
      });
    }

    const tasks = await this.#client.query<TaskRow>(
      `select id, class_section_id, created_by, state, revision,
              created_at, updated_at
       from course_tasks
       where class_section_id = any($1::uuid[])`,
      [classSectionIds],
    );
    const taskIds = tasks.rows.map(({ id }) => id);
    for (const row of tasks.rows) {
      records.push({
        record_type: 'course_task',
        id: row.id,
        payload: {
          id: row.id,
          class_section_id: row.class_section_id,
          created_by: row.created_by,
          state: row.state,
          revision: row.revision,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        },
      });
    }
    if (taskIds.length === 0) return;

    const proposals = await this.#client.query<ProposalRow>(
      `select id, task_id, author_id, title, deadline, description,
              evidence_note, evidence_url, content_fingerprint, state,
              revision, created_at
       from task_proposals
       where task_id = any($1::uuid[])`,
      [taskIds],
    );
    const proposalIds = proposals.rows.map(({ id }) => id);
    for (const row of proposals.rows) {
      records.push({
        record_type: 'task_proposal',
        id: row.id,
        payload: {
          id: row.id,
          course_task_id: row.task_id,
          author_id: row.author_id,
          title: row.title,
          deadline: row.deadline.toISOString(),
          description: row.description,
          evidence_note: row.evidence_note,
          evidence_url: row.evidence_url,
          content_fingerprint: row.content_fingerprint,
          state: row.state,
          revision: row.revision,
          created_at: row.created_at.toISOString(),
        },
      });
    }

    if (proposalIds.length > 0) {
      const totals = await this.#client.query<{
        proposal_id: string;
        up: number;
        down: number;
        updated_at: Date;
      }>(
        `select proposal_id, up, down, updated_at
         from proposal_vote_totals
         where proposal_id = any($1::uuid[])`,
        [proposalIds],
      );
      for (const row of totals.rows) {
        records.push({
          record_type: 'proposal_vote_totals',
          id: row.proposal_id,
          payload: {
            proposal_id: row.proposal_id,
            up: row.up,
            down: row.down,
            updated_at: row.updated_at.toISOString(),
          },
        });
      }
      const votes = await this.#client.query<{
        proposal_id: string;
        direction: string;
        updated_at: Date;
      }>(
        `select proposal_id, direction, updated_at
         from accuracy_votes
         where user_id = $1 and proposal_id = any($2::uuid[])`,
        [userId, proposalIds],
      );
      for (const row of votes.rows) {
        records.push({
          record_type: 'accuracy_vote',
          id: row.proposal_id,
          payload: {
            proposal_id: row.proposal_id,
            value: row.direction,
            updated_at: row.updated_at.toISOString(),
          },
        });
      }
    }

    const comments = await this.#client.query<CommentRow>(
      `select tc.id, tc.task_id, tc.author_id, tc.current_revision,
              latest.body, tc.state, tc.deleted_at,
              tc.created_at, tc.updated_at
       from task_comments tc
       left join lateral (
         select body
         from comment_revisions cr
         where cr.comment_id = tc.id
         order by cr.revision desc
         limit 1
       ) latest on true
       where tc.task_id = any($1::uuid[])`,
      [taskIds],
    );
    for (const row of comments.rows) {
      records.push({
        record_type: 'task_comment',
        id: row.id,
        payload: {
          id: row.id,
          course_task_id: row.task_id,
          author_id: row.author_id,
          body: row.body,
          revision: row.current_revision,
          state: row.state,
          deleted_at: date(row.deleted_at),
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        },
      });
    }

    const authorIds = new Set<string>();
    for (const id of [
      ...tasks.rows.map(({ created_by }) => created_by),
      ...proposals.rows.map(({ author_id }) => author_id),
      ...comments.rows.map(({ author_id }) => author_id),
    ]) {
      if (id !== null && id !== userId) authorIds.add(id);
    }
    for (const authorId of authorIds) {
      await this.#appendUserProfile(records, authorId, 'public_user_profile');
    }
  }
}
