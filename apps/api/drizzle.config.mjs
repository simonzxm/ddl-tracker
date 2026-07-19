import process from 'node:process';

import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
  strict: true,
  verbose: true,
  ...(databaseUrl === undefined
    ? {}
    : { dbCredentials: { url: databaseUrl } }),
});
