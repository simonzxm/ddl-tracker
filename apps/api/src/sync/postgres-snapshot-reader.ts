import type { Client } from 'pg';

import {
  snapshotRecordV2Schema,
  type ContentTombstone,
  type SnapshotRecordType,
  type SnapshotRecordV2,
} from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';

export type SnapshotRecord = SnapshotRecordV2 & { id: string };

type SnapshotPayload<Type extends SnapshotRecordType> = Extract<
  SnapshotRecordV2,
  { record_type: Type }
>['payload'];

function snapshotRecord<Type extends SnapshotRecordType>(
  recordType: Type,
  id: string,
  payload: SnapshotPayload<Type>,
): SnapshotRecord {
  const record = snapshotRecordV2Schema.parse({
    record_type: recordType,
    schema_version: 1,
    payload,
  });
  return { ...record, id };
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
  state: 'visible' | 'hidden' | 'merged';
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
  state: 'visible' | 'hidden' | 'redirected';
  revision: number;
  created_at: Date;
}

interface CommentRow {
  id: string;
  task_id: string;
  author_id: string | null;
  current_revision: number;
  body: string | null;
  state: 'visible' | 'hidden';
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ClassSectionSnapshotRow {
  id: string;
  course_id: string;
  external_section_id: string;
  section_number: string;
  department_code: string | null;
  department_name: string | null;
  instructors: unknown;
  campus: string | null;
  capacity: number | null;
  schedule_text: string | null;
  active: boolean;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

function compareKey(
  left: { record_type: string; id: string },
  right: { record_type: string; id: string },
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

function instructorList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Stored class section instructors are invalid.');
  }
  return value;
}

function requiredCommentBody(value: string | null): string {
  if (value === null) {
    throw new Error('Visible task comment is missing its current revision body.');
  }
  return value;
}

function classSectionSnapshotRecord(
  row: ClassSectionSnapshotRow,
): SnapshotRecord {
  return snapshotRecord('class_section', row.id, {
    id: row.id,
    course_id: row.course_id,
    external_section_id: row.external_section_id,
    section_number: row.section_number,
    department_code: row.department_code,
    department_name: row.department_name,
    instructors: instructorList(row.instructors),
    campus: row.campus,
    capacity: row.capacity,
    schedule_text: row.schedule_text,
    active: row.active,
    revision: row.revision,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

function hiddenTombstone(
  id: string,
  entityType: 'course_task' | 'task_proposal' | 'task_comment',
  revision: number,
): SnapshotRecord {
  const payload: ContentTombstone = {
    entity_type: entityType,
    entity_id: id,
    state: 'hidden',
    revision,
  };
  return snapshotRecord('content_tombstone', id, payload);
}

function deletedCommentTombstone(
  id: string,
  revision: number,
  deletedAt: Date,
): SnapshotRecord {
  return snapshotRecord('content_tombstone', id, {
    entity_type: 'task_comment',
    entity_id: id,
    state: 'deleted',
    revision,
    deleted_at: deletedAt.toISOString(),
  });
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
    await this.#appendUserProfile(records, input.userId);

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
      records.push(
        snapshotRecord('followed_class_section', row.class_section_id, {
          class_section_id: row.class_section_id,
          followed_at: row.created_at.toISOString(),
        }),
      );
    }

    const todos = await this.#client.query<{
      id: string;
      class_section_id: string | null;
      title: string;
      deadline: Date | null;
      note: string | null;
      state: 'pending' | 'completed' | 'ignored';
      revision: number;
      deleted_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, class_section_id, title, deadline, note, state, revision,
              deleted_at, created_at, updated_at
       from personal_todos
       where user_id = $1 and deleted_at is null`,
      [input.userId],
    );
    for (const row of todos.rows) {
      records.push(
        snapshotRecord('personal_todo', row.id, {
          id: row.id,
          class_section_id: row.class_section_id,
          title: row.title,
          deadline: date(row.deadline),
          note: row.note,
          state: row.state,
          revision: row.revision,
          deleted_at: null,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        }),
      );
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
    const section = await this.#client.query<ClassSectionSnapshotRow>(
      `select id, course_id, external_section_id, section_number,
              department_code, department_name, instructors, campus,
              capacity, schedule_text,
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
    const records: SnapshotRecord[] = [classSectionSnapshotRecord(row)];
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
  ): Promise<void> {
    const result = await this.#client.query<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      bio: string | null;
      status: 'active' | 'suspended';
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
    records.push(
      snapshotRecord('public_user_profile', row.id, {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        bio: row.bio,
        status: row.status,
        revision: row.profile_revision,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      }),
    );
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
      records.push(
        snapshotRecord('personal_task_details', row.task_id, {
          course_task_id: row.task_id,
          private_title: row.private_title,
          private_deadline: date(row.private_deadline),
          private_note: row.private_note,
          revision: row.revision,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        }),
      );
    }

    const statePredicate =
      classSectionId === null
        ? ''
        : ' and exists (select 1 from course_tasks ct where ct.id = s.task_id and ct.class_section_id = $2)';
    const states = await this.#client.query<{
      task_id: string;
      state: 'pending' | 'completed' | 'ignored';
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
      records.push(
        snapshotRecord('personal_task_state', row.task_id, {
          course_task_id: row.task_id,
          state: row.state,
          revision: row.revision,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        }),
      );
    }
  }

  async #appendSharedSectionRecords(
    records: SnapshotRecord[],
    userId: string,
    classSectionIds: string[],
  ): Promise<void> {
    if (classSectionIds.length === 0) return;
    const sections = await this.#client.query<ClassSectionSnapshotRow>(
      `select id, course_id, external_section_id, section_number,
              department_code, department_name, instructors, campus,
              capacity, schedule_text,
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
      records.push(classSectionSnapshotRecord(row));
    }

    const tasks = await this.#client.query<TaskRow>(
      `select id, class_section_id, created_by, state, revision,
              created_at, updated_at
       from course_tasks
       where class_section_id = any($1::uuid[])`,
      [classSectionIds],
    );
    const taskById = new Map(tasks.rows.map((task) => [task.id, task]));
    const allTaskIds = tasks.rows.map(({ id }) => id);
    const visibleTasks = tasks.rows.filter(({ state }) => state === 'visible');
    const visibleTaskIds = visibleTasks.map(({ id }) => id);
    for (const row of tasks.rows) {
      if (row.state === 'visible') {
        records.push(
          snapshotRecord('course_task', row.id, {
            id: row.id,
            class_section_id: row.class_section_id,
            created_by: row.created_by,
            state: 'visible',
            revision: row.revision,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
          }),
        );
      } else if (row.state === 'hidden') {
        records.push(hiddenTombstone(row.id, 'course_task', row.revision));
      }
    }
    const mergedTaskIds = tasks.rows
      .filter(({ state }) => state === 'merged')
      .map(({ id }) => id);
    if (mergedTaskIds.length > 0) {
      const merges = await this.#client.query<{
        source_task_id: string;
        target_task_id: string;
        reason: string;
        created_at: Date;
        revision: number;
      }>(
        `select tm.source_task_id, tm.target_task_id, tm.reason,
                tm.created_at, source.revision
         from task_merges tm
         join course_tasks source on source.id = tm.source_task_id
         where tm.source_task_id = any($1::uuid[])`,
        [mergedTaskIds],
      );
      for (const merge of merges.rows) {
        records.push(
          snapshotRecord('task_merge', merge.source_task_id, {
            source_task_id: merge.source_task_id,
            target_task_id: merge.target_task_id,
            reason: merge.reason,
            revision: merge.revision,
            created_at: merge.created_at.toISOString(),
          }),
        );
      }
    }
    if (allTaskIds.length === 0) return;

    const proposals = await this.#client.query<ProposalRow>(
      `select id, task_id, author_id, title, deadline, description,
              evidence_note, evidence_url, content_fingerprint, state,
              revision, created_at
       from task_proposals
       where task_id = any($1::uuid[])`,
      [allTaskIds],
    );
    const visibleProposals: ProposalRow[] = [];
    const redirectedProposalIds: string[] = [];
    for (const row of proposals.rows) {
      const parent = taskById.get(row.task_id);
      if (row.state === 'redirected') {
        redirectedProposalIds.push(row.id);
        continue;
      }
      if (parent?.state !== 'visible') continue;
      if (row.state === 'hidden') {
        records.push(hiddenTombstone(row.id, 'task_proposal', row.revision));
        continue;
      }
      visibleProposals.push(row);
      records.push(
        snapshotRecord('task_proposal', row.id, {
          id: row.id,
          course_task_id: row.task_id,
          author_id: row.author_id,
          title: row.title,
          deadline: row.deadline.toISOString(),
          description: row.description,
          evidence_note: row.evidence_note,
          evidence_url: row.evidence_url,
          content_fingerprint: row.content_fingerprint,
          state: 'visible',
          revision: row.revision,
          created_at: row.created_at.toISOString(),
        }),
      );
    }
    if (redirectedProposalIds.length > 0) {
      const redirects = await this.#client.query<{
        source_proposal_id: string;
        canonical_proposal_id: string;
        created_at: Date;
        revision: number;
      }>(
        `select r.source_proposal_id, r.canonical_proposal_id,
                r.created_at, source.revision
         from proposal_redirects r
         join task_proposals source on source.id = r.source_proposal_id
         where r.source_proposal_id = any($1::uuid[])`,
        [redirectedProposalIds],
      );
      for (const redirect of redirects.rows) {
        records.push(
          snapshotRecord('proposal_redirect', redirect.source_proposal_id, {
            source_proposal_id: redirect.source_proposal_id,
            canonical_proposal_id: redirect.canonical_proposal_id,
            revision: redirect.revision,
            created_at: redirect.created_at.toISOString(),
          }),
        );
      }
    }

    const visibleProposalIds = visibleProposals.map(({ id }) => id);
    if (visibleProposalIds.length > 0) {
      const totals = await this.#client.query<{
        proposal_id: string;
        up: number;
        down: number;
        updated_at: Date;
      }>(
        `select proposal_id, up, down, updated_at
         from proposal_vote_totals
         where proposal_id = any($1::uuid[])`,
        [visibleProposalIds],
      );
      for (const row of totals.rows) {
        records.push(
          snapshotRecord('proposal_vote_totals', row.proposal_id, {
            proposal_id: row.proposal_id,
            up: row.up,
            down: row.down,
            updated_at: row.updated_at.toISOString(),
          }),
        );
      }
      const votes = await this.#client.query<{
        proposal_id: string;
        direction: 'up' | 'down';
        updated_at: Date;
      }>(
        `select proposal_id, direction, updated_at
         from accuracy_votes
         where user_id = $1 and proposal_id = any($2::uuid[])`,
        [userId, visibleProposalIds],
      );
      for (const row of votes.rows) {
        records.push(
          snapshotRecord('accuracy_vote', row.proposal_id, {
            proposal_id: row.proposal_id,
            value: row.direction,
            updated_at: row.updated_at.toISOString(),
          }),
        );
      }
    }

    const visibleComments: CommentRow[] = [];
    if (visibleTaskIds.length > 0) {
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
        [visibleTaskIds],
      );
      for (const row of comments.rows) {
        if (row.state === 'hidden' || row.deleted_at !== null) {
          records.push(
            row.deleted_at === null
              ? hiddenTombstone(row.id, 'task_comment', row.current_revision)
              : deletedCommentTombstone(
                  row.id,
                  row.current_revision,
                  row.deleted_at,
                ),
          );
          continue;
        }
        visibleComments.push(row);
        records.push(
          snapshotRecord('task_comment', row.id, {
            id: row.id,
            course_task_id: row.task_id,
            author_id: row.author_id,
            body: requiredCommentBody(row.body),
            revision: row.current_revision,
            state: 'visible',
            deleted_at: null,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
          }),
        );
      }
    }

    const authorIds = new Set<string>();
    for (const id of [
      ...visibleTasks.map(({ created_by }) => created_by),
      ...visibleProposals.map(({ author_id }) => author_id),
      ...visibleComments.map(({ author_id }) => author_id),
    ]) {
      if (id !== null && id !== userId) authorIds.add(id);
    }
    for (const authorId of authorIds) {
      await this.#appendUserProfile(records, authorId);
    }
  }
}
