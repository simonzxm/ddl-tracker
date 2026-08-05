import { URL } from 'node:url';

export function assertDisposableTestDatabaseUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== '/ddl_tracker_test'
  ) {
    throw new Error(
      'TEST_DATABASE_URL must target the disposable ddl_tracker_test database.',
    );
  }
  return connectionString;
}
