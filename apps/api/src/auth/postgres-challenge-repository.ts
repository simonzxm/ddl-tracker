import type { Client } from 'pg';

import type {
  ActiveChallenge,
  ChallengeRepository,
} from './email-challenge-service.js';

interface ChallengeRow {
  id: string;
  provider: string;
  normalized_subject: string;
  subject_display: string;
  code_hmac: string;
  attempts: number;
  expires_at: Date;
  created_at: Date;
}

function toActiveChallenge(row: ChallengeRow): ActiveChallenge {
  if (row.provider !== 'email') {
    throw new Error('Unexpected authentication provider.');
  }
  return {
    id: row.id,
    provider: 'email',
    normalizedSubject: row.normalized_subject,
    subjectDisplay: row.subject_display,
    codeHmac: row.code_hmac,
    attempts: row.attempts,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export class PostgresChallengeRepository implements ChallengeRepository {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async findLatestCreatedAt(
    provider: 'email',
    normalizedSubject: string,
  ): Promise<Date | null> {
    const result = await this.#client.query<{ created_at: Date }>(
      `select created_at
       from auth_challenges
       where provider = $1 and normalized_subject = $2
       order by created_at desc
       limit 1`,
      [provider, normalizedSubject],
    );
    return result.rows[0]?.created_at ?? null;
  }

  async createPending(input: ActiveChallenge): Promise<void> {
    await this.#client.query(
      `insert into auth_challenges (
         id, provider, normalized_subject, subject_display, code_hmac,
         status, attempts, send_attempted_at, expires_at, created_at
       ) values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)`,
      [
        input.id,
        input.provider,
        input.normalizedSubject,
        input.subjectDisplay,
        input.codeHmac,
        input.attempts,
        input.createdAt,
        input.expiresAt,
        input.createdAt,
      ],
    );
  }

  async activatePending(
    id: string,
    provider: 'email',
    normalizedSubject: string,
  ): Promise<void> {
    await this.#client.query('begin');
    try {
      await this.#client.query(
        `update auth_challenges
         set status = 'expired'
         where provider = $1
           and normalized_subject = $2
           and status = 'active'
           and id <> $3`,
        [provider, normalizedSubject, id],
      );
      const activated = await this.#client.query(
        `update auth_challenges
         set status = 'active', sent_at = now(), activated_at = now()
         where id = $1 and status = 'pending'`,
        [id],
      );
      if (activated.rowCount !== 1) {
        throw new Error('Pending challenge could not be activated.');
      }
      await this.#client.query('commit');
    } catch (error) {
      await this.#client.query('rollback');
      throw error;
    }
  }

  async abandonPending(id: string): Promise<void> {
    await this.#client.query(
      `update auth_challenges
       set status = 'expired'
       where id = $1 and status = 'pending'`,
      [id],
    );
  }

  async findActive(
    id: string,
    provider: 'email',
    normalizedSubject: string,
  ): Promise<ActiveChallenge | null> {
    const result = await this.#client.query<ChallengeRow>(
      `select id, provider, normalized_subject, subject_display, code_hmac,
              attempts, expires_at, created_at
       from auth_challenges
       where id = $1
         and provider = $2
         and normalized_subject = $3
         and status = 'active'
       limit 1`,
      [id, provider, normalizedSubject],
    );
    const row = result.rows[0];
    return row === undefined ? null : toActiveChallenge(row);
  }

  async recordFailedAttempt(
    id: string,
    maximumAttempts: number,
  ): Promise<{ attempts: number; locked: boolean }> {
    const result = await this.#client.query<{ attempts: number }>(
      `update auth_challenges
       set attempts = attempts + 1
       where id = $1 and status = 'active' and attempts < $2
       returning attempts`,
      [id, maximumAttempts],
    );
    const attempts = result.rows[0]?.attempts ?? maximumAttempts;
    return { attempts, locked: attempts >= maximumAttempts };
  }

  async consume(id: string): Promise<boolean> {
    const result = await this.#client.query(
      `update auth_challenges
       set status = 'consumed', consumed_at = now()
       where id = $1
         and status = 'active'
         and attempts < $2
         and expires_at > now()`,
      [id, 5],
    );
    return result.rowCount === 1;
  }
}
