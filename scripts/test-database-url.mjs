import { URL } from 'node:url';

export function assertDisposableTestDatabaseUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !localHosts.has(url.hostname) ||
    url.pathname !== '/ddl_tracker_test'
  ) {
    throw new Error(
      'TEST_DATABASE_URL must target the local disposable ddl_tracker_test database.',
    );
  }
  return connectionString;
}
