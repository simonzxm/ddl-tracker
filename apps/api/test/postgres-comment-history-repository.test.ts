import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresCommentHistoryRepository } from '../src/comments/postgres-comment-history-repository.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const AUTHOR_ID = '018f0000-0000-7000-8000-000000002901';
const VIEWER_ID = '018f0000-0000-7000-8000-000000002902';
const TERM_ID = '018f0000-0000-7000-8000-000000002903';
const COURSE_ID = '018f0000-0000-7000-8000-000000002904';
const SECTION_ID = '018f0000-0000-7000-8000-000000002905';
const TASK_ID = '018f0000-0000-7000-8000-000000002906';
const COMMENT_ID = '018f0000-0000-7000-8000-000000002907';

async function seed(client: Client): Promise<void> {
  await client.query(
    `insert into users (
       id, username, username_key, display_name, status, profile_revision
     ) values
       ($1, 'author', 'author', 'Author', 'active', 1),
       ($2, 'viewer', 'viewer', 'Viewer', 'active', 1)`,
    [AUTHOR_ID, VIEWER_ID],
  );
  await client.query(
    `insert into academic_terms (id, external_term_code, name)
     values ($1, 'term-history', 'Term')`,
    [TERM_ID],
  );
  await client.query(
    `insert into courses (id, term_id, external_course_code, name)
     values ($1, $2, 'course-history', 'Course')`,
    [COURSE_ID, TERM_ID],
  );
  await client.query(
    `insert into class_sections (
       id, course_id, external_section_id, section_number
     ) values ($1, $2, 'section-history', '01')`,
    [SECTION_ID, COURSE_ID],
  );
  await client.query(
    `insert into course_tasks (id, class_section_id, created_by)
     values ($1, $2, $3)`,
    [TASK_ID, SECTION_ID, AUTHOR_ID],
  );
  await client.query(
    `insert into task_comments (
       id, task_id, author_id, current_revision
     ) values ($1, $2, $3, 3)`,
    [COMMENT_ID, TASK_ID, AUTHOR_ID],
  );
  await client.query(
    `insert into comment_revisions (
       comment_id, revision, body, author_id, created_at
     ) values
       ($1, 1, 'First', $2, '2026-07-19T10:00:00Z'),
       ($1, 2, 'Second', $2, '2026-07-19T11:00:00Z'),
       ($1, 3, 'Third', $2, '2026-07-19T12:00:00Z')`,
    [COMMENT_ID, AUTHOR_ID],
  );
}

describePostgres('PostgresCommentHistoryRepository', () => {
  let client: Client;
  let repository: PostgresCommentHistoryRepository;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    repository = new PostgresCommentHistoryRepository(client);
  });

  beforeEach(async () => {
    await client.query(`
      truncate table comment_revisions, task_comments, course_tasks,
        class_sections, courses, academic_terms, users restart identity cascade
    `);
    await seed(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it('returns visible revisions chronologically with a continuation revision', async () => {
    const first = await repository.list({
      commentId: COMMENT_ID,
      userId: VIEWER_ID,
      maintainer: false,
      afterRevision: 0,
      limit: 2,
    });
    expect(first.revisions.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(first.next_after_revision).toBe(2);

    const second = await repository.list({
      commentId: COMMENT_ID,
      userId: VIEWER_ID,
      maintainer: false,
      afterRevision: first.next_after_revision ?? 0,
      limit: 2,
    });
    expect(second.revisions.map(({ revision }) => revision)).toEqual([3]);
    expect(second.next_after_revision).toBeNull();
  });

  it('hides deleted history from ordinary viewers', async () => {
    await client.query(
      'update task_comments set deleted_at = now() where id = $1',
      [COMMENT_ID],
    );
    await expect(
      repository.list({
        commentId: COMMENT_ID,
        userId: VIEWER_ID,
        maintainer: false,
        afterRevision: 0,
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'content_hidden', status: 403 });
  });

  it('allows the author and a maintainer to inspect retained history', async () => {
    await client.query(
      "update task_comments set state = 'hidden', deleted_at = now() where id = $1",
      [COMMENT_ID],
    );
    const authorPage = await repository.list({
      commentId: COMMENT_ID,
      userId: AUTHOR_ID,
      maintainer: false,
      afterRevision: 0,
      limit: 10,
    });
    expect(authorPage.revisions.map(({ revision }) => revision)).toEqual([
      1, 2, 3,
    ]);

    const maintainerPage = await repository.list({
      commentId: COMMENT_ID,
      userId: VIEWER_ID,
      maintainer: true,
      afterRevision: 0,
      limit: 10,
    });
    expect(maintainerPage.revisions.map(({ revision }) => revision)).toEqual([
      1, 2, 3,
    ]);
  });
});
