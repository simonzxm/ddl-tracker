import {
  accountSnapshotResponseSchema,
  classSectionSnapshotResponseSchema,
  snapshotRecordSchema,
  type SyncRequest,
} from '@ddl-tracker/contracts';

import { HttpError } from '../http/errors.js';
import type { SyncCursorCodec } from './cursor.js';
import type { IncrementalSyncService } from './incremental-service.js';
import type {
  PostgresSnapshotReader,
  SnapshotAfter,
  SnapshotPage,
} from './postgres-snapshot-reader.js';
import type { SnapshotTokenCodec } from './snapshot-token.js';

type AccountSnapshotRequest = Extract<
  SyncRequest,
  { mode: 'account_snapshot' }
>;
type ClassSectionSnapshotRequest = Extract<
  SyncRequest,
  { mode: 'class_section_snapshot' }
>;

interface IncrementalExecutor {
  execute(input: Parameters<IncrementalSyncService['execute']>[0]): ReturnType<
    IncrementalSyncService['execute']
  >;
}

interface SnapshotReader {
  readAnchor(): ReturnType<PostgresSnapshotReader['readAnchor']>;
  readAccountPage(
    input: Parameters<PostgresSnapshotReader['readAccountPage']>[0],
  ): ReturnType<PostgresSnapshotReader['readAccountPage']>;
  readClassSectionPage(
    input: Parameters<PostgresSnapshotReader['readClassSectionPage']>[0],
  ): ReturnType<PostgresSnapshotReader['readClassSectionPage']>;
}

interface CursorCodec {
  encode(userId: string, sequence: number): Promise<string>;
  decode(cursor: string, expectedUserId: string): Promise<{ sequence: number }>;
}

interface SnapshotCodec {
  createAccount(
    userId: string,
    anchorSequence: number,
    now: Date,
  ): Promise<string>;
  createClassSection(
    userId: string,
    classSectionId: string,
    anchorSequence: number,
    now: Date,
  ): Promise<string>;
  renew(
    snapshotToken: string,
    expectedUserId: string,
    now: Date,
  ): Promise<string>;
  createPage(
    snapshotToken: string,
    after: SnapshotAfter,
    now: Date,
  ): Promise<string>;
  decodeSnapshot(
    token: string,
    expectedUserId: string,
    now: Date,
  ): Promise<{
    snapshotId: string;
    kind: 'account' | 'class_section';
    classSectionId: string | null;
    anchorSequence: number;
  }>;
  decodePage(
    pageToken: string,
    snapshotToken: string,
    expectedUserId: string,
    now: Date,
  ): Promise<SnapshotAfter>;
}

function invalidSnapshot(message: string, cause?: unknown): HttpError {
  return new HttpError({
    code: 'invalid_request',
    message,
    status: 400,
    details: cause instanceof Error ? { reason: cause.message } : {},
  });
}

function wireRecords(page: SnapshotPage) {
  return page.records.map((record) => {
    const revision =
      'revision' in record.payload ? record.payload.revision : 0;
    return snapshotRecordSchema.parse({
      record_type: record.record_type,
      id: record.id,
      revision,
      payload: record.payload,
    });
  });
}

export class SyncService {
  readonly #cursorCodec: CursorCodec;
  readonly #snapshotCodec: SnapshotCodec;
  readonly #snapshotReader: SnapshotReader;
  readonly #incremental: IncrementalExecutor;
  readonly #now: () => Date;

  constructor(options: {
    cursorCodec: SyncCursorCodec;
    snapshotCodec: SnapshotTokenCodec;
    snapshotReader: SnapshotReader;
    incremental: IncrementalExecutor;
    now?: () => Date;
  }) {
    this.#cursorCodec = options.cursorCodec;
    this.#snapshotCodec = options.snapshotCodec;
    this.#snapshotReader = options.snapshotReader;
    this.#incremental = options.incremental;
    this.#now = options.now ?? (() => new Date());
  }

  execute(input: {
    userId: string;
    maintainer: boolean;
    requestId: string;
    request: SyncRequest;
  }): Promise<unknown> {
    switch (input.request.mode) {
      case 'incremental':
        return this.#incremental.execute({
          userId: input.userId,
          maintainer: input.maintainer,
          requestId: input.requestId,
          request: input.request,
        });
      case 'account_snapshot':
        return this.#accountSnapshot(input.userId, input.requestId, input.request);
      case 'class_section_snapshot':
        return this.#classSectionSnapshot(
          input.userId,
          input.requestId,
          input.request,
        );
    }
  }

  async #accountSnapshot(
    userId: string,
    requestId: string,
    request: AccountSnapshotRequest,
  ): Promise<unknown> {
    const snapshot = await this.#resolveSnapshot({
      userId,
      request,
      kind: 'account',
      classSectionId: null,
    });
    const page = await this.#snapshotReader.readAccountPage({
      userId,
      after: snapshot.after,
      limit: request.snapshot_limit,
    });
    const nextPageToken = await this.#nextPageToken(
      snapshot.token,
      page,
      this.#now(),
    );
    return accountSnapshotResponseSchema.parse({
      protocol_version: 1,
      mode: 'account_snapshot',
      request_id: requestId,
      records: wireRecords(page),
      snapshot_token: snapshot.token,
      next_page_token: nextPageToken,
      snapshot_complete: page.complete,
      next_cursor: page.complete
        ? await this.#cursorCodec.encode(userId, snapshot.anchorSequence)
        : null,
    });
  }

  async #classSectionSnapshot(
    userId: string,
    requestId: string,
    request: ClassSectionSnapshotRequest,
  ): Promise<unknown> {
    try {
      await this.#cursorCodec.decode(request.cursor, userId);
    } catch (error) {
      throw invalidSnapshot('Class section snapshot cursor is invalid.', error);
    }
    const snapshot = await this.#resolveSnapshot({
      userId,
      request,
      kind: 'class_section',
      classSectionId: request.class_section_id,
    });
    const page = await this.#snapshotReader.readClassSectionPage({
      userId,
      classSectionId: request.class_section_id,
      after: snapshot.after,
      limit: request.snapshot_limit,
    });
    const nextPageToken = await this.#nextPageToken(
      snapshot.token,
      page,
      this.#now(),
    );
    return classSectionSnapshotResponseSchema.parse({
      protocol_version: 1,
      mode: 'class_section_snapshot',
      class_section_id: request.class_section_id,
      request_id: requestId,
      records: wireRecords(page),
      snapshot_token: snapshot.token,
      next_page_token: nextPageToken,
      snapshot_complete: page.complete,
      resume_cursor: page.complete ? request.cursor : null,
    });
  }

  async #resolveSnapshot(input: {
    userId: string;
    request: AccountSnapshotRequest | ClassSectionSnapshotRequest;
    kind: 'account' | 'class_section';
    classSectionId: string | null;
  }): Promise<{
    token: string;
    anchorSequence: number;
    after: SnapshotAfter | null;
  }> {
    const now = this.#now();
    if (input.request.page_token !== null && input.request.snapshot_token === null) {
      throw invalidSnapshot('A page token requires its snapshot token.');
    }
    if (input.request.snapshot_token === null) {
      const anchorSequence = await this.#snapshotReader.readAnchor();
      const token =
        input.kind === 'account'
          ? await this.#snapshotCodec.createAccount(
              input.userId,
              anchorSequence,
              now,
            )
          : await this.#snapshotCodec.createClassSection(
              input.userId,
              input.classSectionId ?? '',
              anchorSequence,
              now,
            );
      return { token, anchorSequence, after: null };
    }

    try {
      const decoded = await this.#snapshotCodec.decodeSnapshot(
        input.request.snapshot_token,
        input.userId,
        now,
      );
      if (
        decoded.kind !== input.kind ||
        decoded.classSectionId !== input.classSectionId
      ) {
        throw new Error('Snapshot token mode binding does not match.');
      }
      const after =
        input.request.page_token === null
          ? null
          : await this.#snapshotCodec.decodePage(
              input.request.page_token,
              input.request.snapshot_token,
              input.userId,
              now,
            );
      return {
        token: await this.#snapshotCodec.renew(
          input.request.snapshot_token,
          input.userId,
          now,
        ),
        anchorSequence: decoded.anchorSequence,
        after,
      };
    } catch (error) {
      throw invalidSnapshot('Snapshot continuation is invalid.', error);
    }
  }

  async #nextPageToken(
    snapshotToken: string,
    page: SnapshotPage,
    now: Date,
  ): Promise<string | null> {
    if (page.complete) return null;
    if (page.nextAfter === null) {
      throw new Error('Incomplete snapshot page is missing its continuation key.');
    }
    return this.#snapshotCodec.createPage(snapshotToken, page.nextAfter, now);
  }
}
