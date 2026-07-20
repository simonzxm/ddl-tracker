import { createUuidV7 } from '@ddl-tracker/contracts';
import type { Client } from 'pg';

import { MaintainerAccessService } from './admin/maintainer-access-service.js';
import { PostgresMaintainerAccessRepository } from './admin/postgres-maintainer-access-repository.js';
import { PostgresModerationRepository } from './admin/postgres-moderation-repository.js';
import { PostgresTaskMergeRepository } from './admin/postgres-task-merge-repository.js';
import { AccountLifecycleService } from './auth/account-lifecycle-service.js';
import { AccountService } from './auth/account-service.js';
import {
  EmailChallengeService,
  type MailDelivery,
} from './auth/email-challenge-service.js';
import { PostgresAccountLifecycleRepository } from './auth/postgres-account-lifecycle-repository.js';
import { PostgresAccountRepository } from './auth/postgres-account-repository.js';
import { PostgresChallengeRepository } from './auth/postgres-challenge-repository.js';
import {
  SmtpMailDelivery,
  type SmtpSession,
} from './auth/smtp-mail-delivery.js';
import { CatalogImportApplyService } from './catalog/import-apply-service.js';
import { CatalogImportService } from './catalog/import-service.js';
import { CatalogService } from './catalog/catalog-service.js';
import { PostgresCatalogRepository } from './catalog/postgres-catalog-repository.js';
import { PostgresCatalogImportApplyRepository } from './catalog/postgres-import-apply-repository.js';
import { PostgresCatalogImportRepository } from './catalog/postgres-import-plan-repository.js';
import { PostgresCommentHistoryRepository } from './comments/postgres-comment-history-repository.js';
import {
  createApp,
  type RequestLogEntry,
} from './http/app.js';
import { PostgresRateLimiter } from './security/postgres-rate-limiter.js';
import { RequestRateLimitService } from './security/request-rate-limit-service.js';
import { SyncBatchService } from './sync/batch-service.js';
import { SyncCursorCodec } from './sync/cursor.js';
import { IncrementalSyncService } from './sync/incremental-service.js';
import { PostgresSyncBatchRepository } from './sync/postgres-batch-repository.js';
import { PostgresSyncEventReader } from './sync/postgres-event-reader.js';
import { PostgresStudentOperationExecutor } from './sync/postgres-operation-executor.js';
import { PostgresSnapshotReader } from './sync/postgres-snapshot-reader.js';
import { SnapshotTokenCodec } from './sync/snapshot-token.js';
import { SyncService } from './sync/sync-service.js';

export interface RuntimeAppOptions {
  mailDelivery?: MailDelivery;
  createSmtpSession?: () => SmtpSession;
  createId?: () => string;
  now?: () => Date;
  nowMilliseconds?: () => number;
  logRequest?: (entry: RequestLogEntry) => void;
}

export function createRuntimeApp(
  client: Client,
  env: Env,
  options: RuntimeAppOptions = {},
) {
  const createId = options.createId ?? createUuidV7;
  const now = options.now ?? (() => new Date());
  const rateLimiter = new PostgresRateLimiter(client);
  const requestRateLimits = new RequestRateLimitService(rateLimiter, { now });
  const accountRepository = new PostgresAccountRepository(client);
  const accountService = new AccountService({
    repository: accountRepository,
    tokenPepper: env.TOKEN_PEPPER,
    createId,
    now,
  });
  const lifecycleService = new AccountLifecycleService({
    repository: new PostgresAccountLifecycleRepository(client),
    createId,
    now,
  });
  const challengeService = new EmailChallengeService({
    repository: new PostgresChallengeRepository(client),
    mailDelivery:
      options.mailDelivery ??
      createMailDelivery(env, options.createSmtpSession),
    allowedDomains: parseAllowedDomains(env.ALLOWED_EMAIL_DOMAINS),
    hmacSecret: env.OTP_HMAC_SECRET,
    rateLimiter,
    createId,
    now,
  });

  const catalogService = new CatalogService({
    repository: new PostgresCatalogRepository(client),
    now,
  });
  const catalogImportService = new CatalogImportService({
    repository: new PostgresCatalogImportRepository(
      client,
      env.APP_ENVIRONMENT,
    ),
    createId,
    now,
  });
  const catalogApplyService = new CatalogImportApplyService({
    repository: new PostgresCatalogImportApplyRepository(
      client,
      env.APP_ENVIRONMENT,
    ),
    createId,
    now,
  });

  const operationExecutor = new PostgresStudentOperationExecutor(client, {
    createId,
    now,
  });
  const batchService = new SyncBatchService({
    repository: new PostgresSyncBatchRepository(client, (userId, operation) =>
      operationExecutor.execute(userId, operation),
    ),
    now,
  });
  const cursorCodec = new SyncCursorCodec(
    env.SYNC_TOKEN_SECRET,
    env.APP_ENVIRONMENT,
  );
  const snapshotCodec = new SnapshotTokenCodec(
    env.SYNC_TOKEN_SECRET,
    env.APP_ENVIRONMENT,
  );
  const incrementalService = new IncrementalSyncService({
    batchExecutor: batchService,
    eventReader: new PostgresSyncEventReader(client),
    cursorCodec,
  });
  const syncService = new SyncService({
    cursorCodec,
    snapshotCodec,
    snapshotReader: new PostgresSnapshotReader(client),
    incremental: incrementalService,
    now,
  });

  const accessRepository = new PostgresMaintainerAccessRepository(client, {
    createId,
    now,
  });
  const accessService = new MaintainerAccessService(
    accessRepository,
    env.MAINTAINER_BOOTSTRAP_TOKEN,
  );
  const moderationRepository = new PostgresModerationRepository(client, {
    createId,
    now,
  });
  const mergeRepository = new PostgresTaskMergeRepository(client, {
    createId,
    now,
  });
  const commentHistory = new PostgresCommentHistoryRepository(client);

  const authenticate = (token: string) => accountService.authenticate(token);
  return createApp({
    createRequestId: createId,
    ...(options.nowMilliseconds === undefined
      ? {}
      : { nowMilliseconds: options.nowMilliseconds }),
    ...(options.logRequest === undefined
      ? {}
      : { logRequest: options.logRequest }),
    checkReady: async () => {
      await client.query('select 1');
      return true;
    },
    auth: {
      requestChallenge: (email) => challengeService.requestChallenge(email),
      verifyChallenge: async (input) => {
        const identity = await challengeService.verifyChallenge({
          challengeId: input.challengeId,
          email: input.email,
          code: input.code,
        });
        return accountService.completeVerification(identity, {
          deviceName: input.deviceName,
          deviceMetadata: input.deviceMetadata,
        });
      },
      registerAccount: (input) => accountService.register(input),
      authenticate,
      listSessions: (userId) => accountService.listSessions(userId),
      revokeSession: (userId, sessionId) =>
        accountService.revokeSession(userId, sessionId),
      revokeAllSessions: (userId) => accountService.revokeAllSessions(userId),
      updateProfile: (userId, input) =>
        lifecycleService.updateProfile(userId, input),
      deleteAccount: (userId) => lifecycleService.deleteAccount(userId),
    },
    catalog: {
      authenticate,
      listTerms: () => catalogService.listTerms(),
      listCourses: (termId) => catalogService.listCourses(termId),
      listClassSections: (courseId) =>
        catalogService.listClassSections(courseId),
    },
    adminCatalog: {
      environment: env.APP_ENVIRONMENT,
      authenticate,
      planBatch: (actorId, request) =>
        catalogImportService.planBatch(actorId, request),
      applyBatch: (actorId, importId, requestId, request) =>
        catalogApplyService.applyBatch(
          actorId,
          importId,
          requestId,
          request,
        ),
      getStatus: (importId) => catalogImportService.getStatus(importId),
    },
    comments: {
      authenticate,
      list: (input) => commentHistory.list(input),
    },
    sync: {
      authenticate,
      rateLimit: (userId) => requestRateLimits.consumeSync(userId),
      handle: (input) => syncService.execute(input),
    },
    admin: {
      authenticate,
      bootstrap: (input) => accessService.bootstrap(input),
      setContentHidden: (input) =>
        moderationRepository.setContentHidden(input),
      listReports: (input) => moderationRepository.listReports(input),
      resolveReport: (input) => moderationRepository.resolveReport(input),
      setUserSuspended: (input) =>
        accessRepository.setUserSuspended(input),
      setMaintainerRole: (input) =>
        accessRepository.setMaintainerRole(input),
      listAudit: (input) => moderationRepository.listAudit(input),
      mergeTask: (input) => mergeRepository.merge(input),
    },
  });
}

function createMailDelivery(
  env: Env,
  createSmtpSession: (() => SmtpSession) | undefined,
): MailDelivery {
  return new SmtpMailDelivery({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    username: env.SMTP_USERNAME,
    password: env.SMTP_PASSWORD,
    fromAddress: env.SMTP_FROM_ADDRESS,
    fromName: env.SMTP_FROM_NAME,
    createSession:
      createSmtpSession ??
      (() => {
        throw new Error('SMTP session factory is not configured.');
      }),
  });
}

function parseAllowedDomains(value: string): string[] {
  const domains = value
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
  if (domains.length === 0) {
    throw new Error('At least one allowed institutional email domain is required.');
  }
  return domains;
}
