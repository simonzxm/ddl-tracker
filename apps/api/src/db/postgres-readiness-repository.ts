import type { Client } from 'pg';

export class PostgresReadinessRepository {
  readonly #client: Client;
  readonly #expectedMigrationHash: string;

  constructor(client: Client, expectedMigrationHash: string) {
    if (!/^[0-9a-f]{64}$/u.test(expectedMigrationHash)) {
      throw new Error('Expected migration hash must be a SHA-256 hex digest.');
    }
    this.#client = client;
    this.#expectedMigrationHash = expectedMigrationHash;
  }

  async isReady(): Promise<boolean> {
    const result = await this.#client.query<{ hash: string }>(
      `select hash
       from drizzle.__drizzle_migrations
       order by id desc
       limit 1`,
    );
    return result.rows[0]?.hash === this.#expectedMigrationHash;
  }
}
