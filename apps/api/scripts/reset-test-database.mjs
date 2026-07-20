import process from 'node:process';
import { URL } from 'node:url';

import { Client } from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('TEST_DATABASE_URL is required.');
}

const url = new URL(connectionString);
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (!databaseName.endsWith('_test') && process.env.ALLOW_DATABASE_RESET !== '1') {
  throw new Error(
    `Refusing to reset database ${databaseName}. Use a *_test database or set ALLOW_DATABASE_RESET=1 explicitly.`,
  );
}

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query('drop schema if exists public cascade');
  await client.query('create schema public');
  await client.query('grant all on schema public to public');
} finally {
  await client.end();
}
