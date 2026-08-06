import { describe, expect, it } from 'vitest';

import { assertDisposableTestDatabaseUrl } from '../../../scripts/test-database-url.mjs';

describe('PostgreSQL test database safety', () => {
  it('accepts only the disposable test database name', () => {
    for (const local of [
      'postgresql://postgres:postgres@127.0.0.1:5432/ddl_tracker_test',
      'postgresql://postgres:postgres@localhost:5432/ddl_tracker_test',
      'postgresql://postgres:postgres@[::1]:5432/ddl_tracker_test',
    ]) {
      expect(assertDisposableTestDatabaseUrl(local)).toContain(
        '/ddl_tracker_test',
      );
    }

    for (const unsafe of [
      'postgresql://postgres:postgres@127.0.0.1:5432/ddl_tracker',
      'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
      'postgresql://postgres:postgres@db.example/ddl_tracker_test',
      'https://127.0.0.1/ddl_tracker_test',
      'not-a-url',
    ]) {
      expect(() => assertDisposableTestDatabaseUrl(unsafe)).toThrow();
    }
  });
});
