import { parseCatalogCsv, type ParsedCatalogCsv } from '@ddl-tracker/catalog-sync';

import type {
  CatalogSource,
  CatalogSourceDescriptor,
} from './github-catalog-source.js';

export interface CatalogSyncApplyInput {
  runId: string;
  repository: string;
  commitSha: string;
  source: CatalogSourceDescriptor;
  catalog: ParsedCatalogCsv;
  startedAt: Date;
  completedAt: Date;
}

export interface CatalogSyncFailureInput {
  runId: string;
  repository: string;
  commitSha: string;
  source: CatalogSourceDescriptor;
  errorMessage: string;
  startedAt: Date;
  completedAt: Date;
}

export interface CatalogSyncRepository {
  currentSourceVersions(repository: string): Promise<Map<string, string>>;
  apply(input: CatalogSyncApplyInput): Promise<{ changed: boolean }>;
  recordFailure(input: CatalogSyncFailureInput): Promise<void>;
}

export interface CatalogSyncResult {
  repository: string;
  commit_sha: string;
  discovered: number;
  unchanged: number;
  synced: number;
  terms: string[];
}

export class CatalogSyncService {
  readonly #source: CatalogSource;
  readonly #repository: CatalogSyncRepository;
  readonly #createId: () => string;
  readonly #now: () => Date;
  readonly #maximumCatalogsPerRun: number;

  constructor(options: {
    source: CatalogSource;
    repository: CatalogSyncRepository;
    createId: () => string;
    now?: () => Date;
    maximumCatalogsPerRun?: number;
  }) {
    this.#source = options.source;
    this.#repository = options.repository;
    this.#createId = options.createId;
    this.#now = options.now ?? (() => new Date());
    this.#maximumCatalogsPerRun = options.maximumCatalogsPerRun ?? 4;
    if (
      !Number.isInteger(this.#maximumCatalogsPerRun) ||
      this.#maximumCatalogsPerRun < 1
    ) {
      throw new Error('Catalog sync run limit must be a positive integer.');
    }
  }

  async sync(): Promise<CatalogSyncResult> {
    const current = await this.#repository.currentSourceVersions(
      this.#source.repository,
    );
    const snapshot = await this.#source.list(current);
    const allChanged = snapshot.catalogs.filter(
      (catalog) => current.get(catalog.termCode) !== catalog.sourceVersion,
    );
    const changed = [...allChanged]
      .sort((left, right) => right.termCode.localeCompare(left.termCode))
      .slice(0, this.#maximumCatalogsPerRun);
    const syncedTerms: string[] = [];

    for (const source of changed) {
      const runId = this.#createId();
      const startedAt = this.#now();
      try {
        const csvBytes = await this.#source.download(source, snapshot.commitSha);
        const catalog = parseCatalogCsv(csvBytes, {
          expectedTermCode: source.termCode,
        });
        await this.#repository.apply({
          runId,
          repository: snapshot.repository,
          commitSha: snapshot.commitSha,
          source,
          catalog,
          startedAt,
          completedAt: this.#now(),
        });
        syncedTerms.push(source.termCode);
      } catch (error) {
        const errorMessage = boundedErrorMessage(error);
        await this.#repository.recordFailure({
          runId,
          repository: snapshot.repository,
          commitSha: snapshot.commitSha,
          source,
          errorMessage,
          startedAt,
          completedAt: this.#now(),
        });
        throw error;
      }
    }

    return {
      repository: snapshot.repository,
      commit_sha: snapshot.commitSha,
      discovered: snapshot.catalogs.length,
      unchanged: snapshot.catalogs.length - allChanged.length,
      synced: syncedTerms.length,
      terms: syncedTerms,
    };
  }
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Catalog synchronization failed.';
  return Array.from(message).slice(0, 2000).join('');
}
