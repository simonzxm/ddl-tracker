import type { Client } from 'pg';

import type {
  OidcLoginRepository,
  OidcLoginStatus,
  OidcLoginTransaction,
} from './oidc-login-service.js';

interface TransactionRow {
  id: string;
  state_hash: string;
  secrets_ciphertext: string | null;
  redirect_uri: string;
  status: OidcLoginStatus;
  issuer: string | null;
  subject: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  exchange_code_hash: string | null;
  error_code: string | null;
  expires_at: Date;
  created_at: Date;
  completed_at: Date | null;
  consumed_at: Date | null;
}

export class PostgresOidcLoginRepository implements OidcLoginRepository {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async createPending(input: OidcLoginTransaction): Promise<void> {
    await this.#client.query(
      `insert into oidc_login_transactions (
         id, state_hash, secrets_ciphertext, redirect_uri, status,
         expires_at, created_at
       ) values ($1, $2, $3, $4, 'pending', $5, $6)`,
      [
        input.id,
        input.stateHash,
        input.secretsCiphertext,
        input.redirectUri,
        input.expiresAt,
        input.createdAt,
      ],
    );
  }

  async findById(id: string): Promise<OidcLoginTransaction | null> {
    const result = await this.#client.query<TransactionRow>(
      `select id, state_hash, secrets_ciphertext, redirect_uri, status,
              issuer, subject, email, display_name, avatar_url,
              exchange_code_hash, error_code, expires_at, created_at,
              completed_at, consumed_at
       from oidc_login_transactions where id = $1 limit 1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : toTransaction(row);
  }

  async claim(id: string, now: Date): Promise<boolean> {
    const result = await this.#client.query(
      `update oidc_login_transactions
       set status = 'exchanging'
       where id = $1 and status = 'pending' and expires_at > $2`,
      [id, now],
    );
    return result.rowCount === 1;
  }

  async complete(input: Parameters<OidcLoginRepository['complete']>[0]): Promise<boolean> {
    const result = await this.#client.query(
      `update oidc_login_transactions
       set status = 'completed', secrets_ciphertext = null,
           issuer = $3, subject = $4, email = $5, display_name = $6,
           avatar_url = $7, exchange_code_hash = $8, completed_at = $2,
           expires_at = $9
       where id = $1 and status = 'exchanging'`,
      [
        input.id,
        input.now,
        input.identity.issuer,
        input.identity.subject,
        input.identity.email,
        input.identity.displayName,
        input.identity.avatarUrl,
        input.exchangeCodeHash,
        input.expiresAt,
      ],
    );
    return result.rowCount === 1;
  }

  async fail(id: string, now: Date, errorCode: string): Promise<void> {
    await this.#client.query(
      `update oidc_login_transactions
       set status = 'failed', secrets_ciphertext = null,
           error_code = $3, completed_at = $2
       where id = $1 and status in ('pending', 'exchanging')`,
      [id, now, errorCode],
    );
  }

  async consume(id: string, now: Date): Promise<boolean> {
    const result = await this.#client.query(
      `update oidc_login_transactions
       set status = 'consumed', consumed_at = $2, exchange_code_hash = null
       where id = $1 and status = 'completed' and expires_at > $2`,
      [id, now],
    );
    return result.rowCount === 1;
  }
}

function toTransaction(row: TransactionRow): OidcLoginTransaction {
  return {
    id: row.id,
    stateHash: row.state_hash,
    secretsCiphertext: row.secrets_ciphertext,
    redirectUri: row.redirect_uri,
    status: row.status,
    issuer: row.issuer,
    subject: row.subject,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    exchangeCodeHash: row.exchange_code_hash,
    errorCode: row.error_code,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    consumedAt: row.consumed_at,
  };
}
