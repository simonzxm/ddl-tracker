import { Client } from 'pg';

import { migrationBundle } from './generated-migrations.js';
import { createMigrationWorker } from './worker-handler.js';

export default createMigrationWorker({
  createClient: (connectionString) => new Client({ connectionString }),
  migrations: migrationBundle,
});
