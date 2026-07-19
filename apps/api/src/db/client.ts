import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import * as schema from './schema/index.js';

export interface ConnectableClient {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
}

export interface DatabaseContext {
  client: Client;
  database: NodePgDatabase<typeof schema>;
}

export async function withConnectedClient<
  ClientType extends ConnectableClient,
  Result,
>(
  createClient: () => ClientType,
  useClient: (client: ClientType) => Promise<Result>,
): Promise<Result> {
  const client = createClient();
  let connected = false;

  try {
    await client.connect();
    connected = true;
    return await useClient(client);
  } finally {
    if (connected) {
      await client.end();
    }
  }
}

export async function withDatabase<Result>(
  connectionString: string,
  useDatabase: (context: DatabaseContext) => Promise<Result>,
): Promise<Result> {
  return withConnectedClient(
    () => new Client({ connectionString }),
    async (client) =>
      useDatabase({
        client,
        database: drizzle(client, { schema }),
      }),
  );
}
