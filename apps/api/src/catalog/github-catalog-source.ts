const DEFAULT_REPOSITORY = 'at-nju/courses';
const DEFAULT_BRANCH = 'main';
const DEFAULT_MAXIMUM_COMPRESSED_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAXIMUM_CSV_BYTES = 10 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CATALOG_PATH_PATTERN = /^data\/(\d{4}-\d{4}-[123])\/courses\.csv\.gz$/u;

export interface CatalogSourceDescriptor {
  termCode: string;
  path: string;
  blobSha: string;
  compressedBytes: number;
}

export interface CatalogSourceSnapshot {
  repository: string;
  commitSha: string;
  catalogs: CatalogSourceDescriptor[];
}

export interface CatalogSource {
  list(): Promise<CatalogSourceSnapshot>;
  download(
    catalog: CatalogSourceDescriptor,
    commitSha: string,
  ): Promise<Uint8Array>;
}

interface GithubCommitResponse {
  sha: string;
}

interface GithubTreeEntry {
  path?: string;
  type?: string;
  sha?: string;
  size?: number;
}

interface GithubTreeResponse {
  truncated?: boolean;
  tree?: GithubTreeEntry[];
}

export class GithubCatalogSource implements CatalogSource {
  readonly #fetcher: typeof fetch;
  readonly #repository: string;
  readonly #branch: string;
  readonly #token: string | undefined;
  readonly #maximumCompressedBytes: number;
  readonly #maximumCsvBytes: number;

  constructor(options: {
    fetcher?: typeof fetch;
    repository?: string;
    branch?: string;
    token?: string;
    maximumCompressedBytes?: number;
    maximumCsvBytes?: number;
  } = {}) {
    this.#fetcher =
      options.fetcher ??
      ((input, init) => globalThis.fetch(input, init));
    this.#repository = options.repository ?? DEFAULT_REPOSITORY;
    this.#branch = options.branch ?? DEFAULT_BRANCH;
    this.#token = options.token;
    this.#maximumCompressedBytes =
      options.maximumCompressedBytes ?? DEFAULT_MAXIMUM_COMPRESSED_BYTES;
    this.#maximumCsvBytes = options.maximumCsvBytes ?? DEFAULT_MAXIMUM_CSV_BYTES;
  }

  async list(): Promise<CatalogSourceSnapshot> {
    const commit = await this.#requestJson<GithubCommitResponse>(
      `https://api.github.com/repos/${this.#repository}/commits/${encodeURIComponent(this.#branch)}`,
    );
    if (!SHA_PATTERN.test(commit.sha)) {
      throw new Error('GitHub returned an invalid catalog commit SHA.');
    }

    const tree = await this.#requestJson<GithubTreeResponse>(
      `https://api.github.com/repos/${this.#repository}/git/trees/${commit.sha}?recursive=1`,
    );
    if (tree.truncated === true) {
      throw new Error('GitHub returned a truncated catalog repository tree.');
    }
    if (!Array.isArray(tree.tree)) {
      throw new Error('GitHub returned an invalid catalog repository tree.');
    }

    const catalogs: CatalogSourceDescriptor[] = [];
    for (const entry of tree.tree) {
      if (entry.type !== 'blob' || typeof entry.path !== 'string') continue;
      const match = CATALOG_PATH_PATTERN.exec(entry.path);
      if (match === null) continue;
      const termCode = match[1];
      if (
        termCode === undefined ||
        typeof entry.sha !== 'string' ||
        !SHA_PATTERN.test(entry.sha) ||
        typeof entry.size !== 'number' ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 1
      ) {
        throw new Error(`GitHub returned invalid metadata for ${entry.path}.`);
      }
      catalogs.push({
        termCode,
        path: entry.path,
        blobSha: entry.sha,
        compressedBytes: entry.size,
      });
    }

    catalogs.sort((left, right) => left.termCode.localeCompare(right.termCode));
    if (catalogs.length === 0) {
      throw new Error('GitHub repository tree contains no catalog datasets.');
    }
    return {
      repository: this.#repository,
      commitSha: commit.sha,
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
    const expectedPath = `data/${catalog.termCode}/courses.csv.gz`;
    if (catalog.path !== expectedPath) {
      throw new Error('Catalog source path does not match its academic term.');
    }

    const response = await this.#fetcher(
      `https://raw.githubusercontent.com/${this.#repository}/${commitSha}/${catalog.path}`,
      {
        headers: {
          accept: 'application/octet-stream',
          ...(this.#token === undefined
            ? {}
            : { authorization: `Bearer ${this.#token}` }),
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `Catalog download failed with status ${String(response.status)}.`,
      );
    }
    const gzipBytes = await readBoundedResponse(
      response,
      this.#maximumCompressedBytes,
    );
    if (gzipBytes[0] !== 0x1f || gzipBytes[1] !== 0x8b) {
      throw new Error('Catalog download did not contain gzip data.');
    }

    try {
      const stream = new Blob([Uint8Array.from(gzipBytes).buffer])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
      return await readBoundedStream(stream, this.#maximumCsvBytes);
    } catch (error) {
      if (error instanceof Error && error.message.includes('size limit')) {
        throw error;
      }
      throw new Error('Catalog gzip data is invalid or truncated.', {
        cause: error,
      });
    }
  }

  async #requestJson<Output>(url: string): Promise<Output> {
    const response = await this.#fetcher(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'ddl-tracker-catalog-sync',
        'x-github-api-version': '2022-11-28',
        ...(this.#token === undefined
          ? {}
          : { authorization: `Bearer ${this.#token}` }),
      },
    });
    if (!response.ok) {
      throw new Error(
        `GitHub catalog request failed with status ${String(response.status)}.`,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error('GitHub catalog response was not valid JSON.', {
        cause: error,
      });
    }
  }
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length !== null) {
    const declared = Number(length);
    if (Number.isFinite(declared) && declared > maximumBytes) {
      throw new Error('Catalog exceeds the compressed size limit.');
    }
  }
  if (response.body === null) return new Uint8Array();
  return readBoundedStream(response.body, maximumBytes);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
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
        throw new Error('Catalog exceeds the expanded size limit.');
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
