import type { Client } from 'pg';

import {
  commentRevisionPageSchema,
  type CommentRevisionPage,
} from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';

export class PostgresCommentHistoryRepository {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async list(input: {
    commentId: string;
    userId: string;
    maintainer: boolean;
    afterRevision: number;
    limit: number;
  }): Promise<CommentRevisionPage> {
    if (
      !Number.isInteger(input.afterRevision) ||
      input.afterRevision < 0 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new HttpError({
        code: 'invalid_request',
        message: 'Comment history pagination is invalid.',
        status: 400,
      });
    }

    const comment = await this.#client.query<{
      author_id: string | null;
      state: 'visible' | 'hidden';
      deleted_at: Date | null;
    }>(
      `select author_id, state, deleted_at
       from task_comments
       where id = $1
       limit 1`,
      [input.commentId],
    );
    const row = comment.rows[0];
    if (row === undefined) {
      throw new HttpError({
        code: 'not_found',
        message: 'Comment not found.',
        status: 404,
      });
    }
    if (
      (row.state === 'hidden' || row.deleted_at !== null) &&
      row.author_id !== input.userId &&
      !input.maintainer
    ) {
      throw new HttpError({
        code: 'content_hidden',
        message: 'Comment history is not available.',
        status: 403,
      });
    }

    const result = await this.#client.query<{
      revision: number;
      body: string;
      author_id: string | null;
      created_at: Date;
    }>(
      `select revision, body, author_id, created_at
       from comment_revisions
       where comment_id = $1 and revision > $2
       order by revision
       limit $3`,
      [input.commentId, input.afterRevision, input.limit + 1],
    );
    const hasMore = result.rows.length > input.limit;
    const selected = result.rows.slice(0, input.limit);
    return commentRevisionPageSchema.parse({
      comment_id: input.commentId,
      revisions: selected.map((revision) => ({
        revision: revision.revision,
        body: revision.body,
        author_id: revision.author_id,
        created_at: revision.created_at.toISOString(),
      })),
      next_after_revision: hasMore
        ? (selected.at(-1)?.revision ?? null)
        : null,
    });
  }
}
