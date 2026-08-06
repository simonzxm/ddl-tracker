const DEFAULT_REPOSITORY = 'at-nju/courses';
const DEFAULT_BRANCH = 'main';
const DEFAULT_MAXIMUM_COMPRESSED_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAXIMUM_CSV_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAXIMUM_DIRECTORY_BYTES = 2 * 1024 * 1024;
const DEFAULT_RECENT_CATALOGS_TO_PROBE = 4;
const DEFAULT_BOOTSTRAP_CATALOGS_TO_PROBE = 4;
const DEFAULT_MINIMUM_TERM_CODE = '2025-2026-1';
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CONTENT_VERSION_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const TERM_CODE_PATTERN = /^(\d{4})-(\d{4})-([123])$/u;

export interface CatalogSourceDescriptor {
  termCode: string;
  path: string;
  sourceVersion: string;
  compressedBytes: number;
}

export interface CatalogSourceSnapshot {
  repository: string;
  commitSha: string;
  catalogs: CatalogSourceDescriptor[];
}

export interface CatalogSource {
  readonly repository: string;
  list(
    currentSourceVersions: ReadonlyMap<string, string>,
  ): Promise<CatalogSourceSnapshot>;
  download(
    catalog: CatalogSourceDescriptor,
    commitSha: string,
  ): Promise<Uint8Array>;
}

export class GithubCatalogSource implements CatalogSource {
  readonly #fetcher: typeof fetch;
  readonly #repository: string;
  readonly #branch: string;
  readonly #maximumCompressedBytes: number;
  readonly #maximumCsvBytes: number;
  readonly #maximumDirectoryBytes: number;
  readonly #recentCatalogsToProbe: number;
  readonly #bootstrapCatalogsToProbe: number;

  constructor(options: {
    fetcher?: typeof fetch;
    repository?: string;
    branch?: string;
    maximumCompressedBytes?: number;
    maximumCsvBytes?: number;
    maximumDirectoryBytes?: number;
    recentCatalogsToProbe?: number;
    bootstrapCatalogsToProbe?: number;
  } = {}) {
    this.#fetcher =
      options.fetcher ??
      ((input, init) => globalThis.fetch(input, init));
    this.#repository = options.repository ?? DEFAULT_REPOSITORY;
    this.#branch = options.branch ?? DEFAULT_BRANCH;
    this.#maximumCompressedBytes =
      options.maximumCompressedBytes ?? DEFAULT_MAXIMUM_COMPRESSED_BYTES;
    this.#maximumCsvBytes = options.maximumCsvBytes ?? DEFAULT_MAXIMUM_CSV_BYTES;
    this.#maximumDirectoryBytes =
      options.maximumDirectoryBytes ?? DEFAULT_MAXIMUM_DIRECTORY_BYTES;
    this.#recentCatalogsToProbe =
      options.recentCatalogsToProbe ?? DEFAULT_RECENT_CATALOGS_TO_PROBE;
    this.#bootstrapCatalogsToProbe =
      options.bootstrapCatalogsToProbe ?? DEFAULT_BOOTSTRAP_CATALOGS_TO_PROBE;
    assertPositiveInteger(
      this.#recentCatalogsToProbe,
      'Recent catalog probe limit',
    );
    assertPositiveInteger(
      this.#bootstrapCatalogsToProbe,
      'Bootstrap catalog probe limit',
    );
  }

  get repository(): string {
    return this.#repository;
  }

  async list(
    currentSourceVersions: ReadonlyMap<string, string>,
  ): Promise<CatalogSourceSnapshot> {
    const directoryUrl =
      `https://github.com/${this.#repository}/tree/` +
      `${encodeURIComponent(this.#branch)}/data`;
    const response = await this.#fetcher(directoryUrl, {
      headers: {
        accept: 'text/html',
        'user-agent': 'ddl-tracker-catalog-sync',
      },
    });
    if (!response.ok) {
      throw new Error(
        `GitHub catalog directory request failed with status ${String(response.status)}.`,
      );
    }
    const htmlBytes = await readBoundedResponse(
      response,
      this.#maximumDirectoryBytes,
      'GitHub catalog directory page',
    );
    let html: string;
    try {
      html = new TextDecoder('utf-8', { fatal: true }).decode(htmlBytes);
    } catch (error) {
      throw new Error('GitHub catalog directory page was not valid UTF-8.', {
        cause: error,
      });
    }

    const commitSha = parseDirectoryCommit(html);
    const termCodes = parseDirectoryTerms(
      html,
      this.#repository,
      this.#branch,
    );
    const newestFirst = [...termCodes].sort((left, right) =>
      right.localeCompare(left),
    );
    const recent = newestFirst.slice(0, this.#recentCatalogsToProbe);
    const bootstrap = newestFirst
      .filter((termCode) => !currentSourceVersions.has(termCode))
      .slice(0, this.#bootstrapCatalogsToProbe);
    const candidates = [...new Set([...recent, ...bootstrap])];
    const catalogs = await Promise.all(
      candidates.map((termCode) => this.#readCatalogMetadata(termCode, commitSha)),
    );
    catalogs.sort((left, right) => left.termCode.localeCompare(right.termCode));

    return {
      repository: this.#repository,
      commitSha,
      catalogs,
    };
  }

  async download(
    catalog: CatalogSourceDescriptor,
    commitSha: string,
  ): Promise<Uint8Array> {
    if (!SHA_PATTERN.test(commitSha)) {
      throw new Error('Catalog commit SHA is invalid.');
    }
    if (catalog.compressedBytes > this.#maximumCompressedBytes) {
      throw new Error('Catalog exceeds the compressed size limit.');
    }
    const expectedPath = catalogPath(catalog.termCode);
    if (catalog.path !== expectedPath) {
      throw new Error('Catalog source path does not match its academic term.');
    }

    const response = await this.#fetcher(
      rawCatalogUrl(this.#repository, commitSha, catalog.path),
      { headers: { accept: 'application/octet-stream' } },
    );
    if (!response.ok) {
      throw new Error(
        `Catalog download failed with status ${String(response.status)}.`,
      );
    }
    const responseVersion = parseEntityTag(response.headers.get('etag'));
    if (
      responseVersion !== null &&
      responseVersion !== catalog.sourceVersion
    ) {
      throw new Error('Catalog download version did not match discovered metadata.');
    }
    const declaredLength = readContentLength(response.headers);
    if (
      declaredLength !== null &&
      declaredLength !== catalog.compressedBytes
    ) {
      throw new Error('Catalog download size did not match discovered metadata.');
    }
    const gzipBytes = await readBoundedResponse(
      response,
      this.#maximumCompressedBytes,
      'Catalog',
    );
    if (gzipBytes[0] !== 0x1f || gzipBytes[1] !== 0x8b) {
      throw new Error('Catalog download did not contain gzip data.');
    }

    try {
      const stream = new Blob([Uint8Array.from(gzipBytes).buffer])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
      return await readBoundedStream(stream, this.#maximumCsvBytes, 'Catalog');
    } catch (error) {
      if (error instanceof Error && error.message.includes('size limit')) {
        throw error;
      }
      throw new Error('Catalog gzip data is invalid or truncated.', {
        cause: error,
      });
    }
  }

  async #readCatalogMetadata(
    termCode: string,
    commitSha: string,
  ): Promise<CatalogSourceDescriptor> {
    const path = catalogPath(termCode);
    const response = await this.#fetcher(
      rawCatalogUrl(this.#repository, commitSha, path),
      {
        method: 'HEAD',
        headers: { accept: 'application/octet-stream' },
      },
    );
    if (!response.ok) {
      throw new Error(
        `GitHub catalog metadata request failed with status ${String(response.status)} for ${termCode}.`,
      );
    }
    const sourceVersion = parseEntityTag(response.headers.get('etag'));
    const compressedBytes = readContentLength(response.headers);
    if (sourceVersion === null || compressedBytes === null || compressedBytes < 1) {
      throw new Error(`GitHub returned invalid catalog metadata for ${termCode}.`);
    }
    if (compressedBytes > this.#maximumCompressedBytes) {
      throw new Error('Catalog exceeds the compressed size limit.');
    }
    return { termCode, path, sourceVersion, compressedBytes };
  }
}

function parseDirectoryCommit(html: string): string {
  const commits = new Set(
    [...html.matchAll(/"currentOid":"([0-9a-f]{40})"/gu)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  );
  if (commits.size !== 1) {
    throw new Error('GitHub catalog directory did not identify one commit SHA.');
  }
  const commitSha = commits.values().next().value;
  if (typeof commitSha !== 'string' || !SHA_PATTERN.test(commitSha)) {
    throw new Error('GitHub returned an invalid catalog commit SHA.');
  }
  return commitSha;
}

function parseDirectoryTerms(
  html: string,
  repository: string,
  branch: string,
): string[] {
  const prefix =
    `/${escapeRegularExpression(repository)}/tree/` +
    `${escapeRegularExpression(branch)}/data/`;
  const pattern = new RegExp(`${prefix}(\\d{4}-\\d{4}-[123])`, 'gu');
  const terms = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    const termCode = match[1];
    if (termCode === undefined) continue;
    assertAcademicTermCode(termCode);
    if (termCode.localeCompare(DEFAULT_MINIMUM_TERM_CODE) >= 0) {
      terms.add(termCode);
    }
  }
  if (terms.size === 0) {
    throw new Error('GitHub catalog directory contains no academic terms.');
  }
  return [...terms].sort((left, right) => left.localeCompare(right));
}

function catalogPath(termCode: string): string {
  assertAcademicTermCode(termCode);
  return `data/${termCode}/courses.csv.gz`;
}

function rawCatalogUrl(
  repository: string,
  commitSha: string,
  path: string,
): string {
  return `https://raw.githubusercontent.com/${repository}/${commitSha}/${path}`;
}

function parseEntityTag(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/^W\//u, '').replace(/^"|"$/gu, '');
  return CONTENT_VERSION_PATTERN.test(normalized) ? normalized : null;
}

function readContentLength(headers: Headers): number | null {
  const value = headers.get('content-length');
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function assertAcademicTermCode(termCode: string): void {
  const identity = TERM_CODE_PATTERN.exec(termCode);
  if (
    identity === null ||
    Number(identity[2]) !== Number(identity[1]) + 1
  ) {
    throw new Error(`Catalog academic term is invalid: ${termCode}.`);
  }
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const declared = readContentLength(response.headers);
  if (declared !== null && declared > maximumBytes) {
    throw new Error(`${label} exceeds the size limit.`);
  }
  if (response.body === null) return new Uint8Array();
  return readBoundedStream(response.body, maximumBytes, label);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds the size limit.`);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
