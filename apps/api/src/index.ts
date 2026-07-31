import { Client } from 'pg';

import { createWorkerHandler } from './worker-handler.js';

export default createWorkerHandler({
  createClient: (connectionString) => new Client({ connectionString }),
  logRequest: (entry) => {
    globalThis.console.log(JSON.stringify({ type: 'http_request', ...entry }));
  },
});
