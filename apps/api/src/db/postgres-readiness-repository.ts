import type { Client } from 'pg';

export class PostgresReadinessRepository {
  readonly #client: Client;
  readonly #requiredMigrationHash: string;

  constructor(client: Client, requiredMigrationHash: string) {
    if (!/^[0-9a-f]{64}$/u.test(requiredMigrationHash)) {
      throw new Error('Required migration hash must be a SHA-256 hex digest.');
    }
    this.#client = client;
    this.#requiredMigrationHash = requiredMigrationHash;
  }

  async isReady(): Promise<boolean> {
    const result = await this.#client.query<{ applied: boolean }>(
      `select exists (
         select 1
         from drizzle.__drizzle_migrations
         where hash = $1
       ) as applied`,
      [this.#requiredMigrationHash],
    );
    return result.rows[0]?.applied === true;
  }
}
