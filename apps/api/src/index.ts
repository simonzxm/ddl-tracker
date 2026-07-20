import { Client } from 'pg';

import { CloudflareSmtpSession } from './auth/cloudflare-smtp-session.js';
import { createWorkerHandler } from './worker-handler.js';

export default createWorkerHandler({
  createClient: (connectionString) => new Client({ connectionString }),
  createSmtpSession: () => new CloudflareSmtpSession(),
  logRequest: (entry) => {
    globalThis.console.log(JSON.stringify({ type: 'http_request', ...entry }));
  },
});
