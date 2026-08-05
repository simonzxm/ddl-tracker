import { describe, expect, it } from 'vitest';

import { assertDisposableTestDatabaseUrl } from '../../../scripts/test-database-url.mjs';

describe('PostgreSQL test database safety', () => {
  it('accepts only the disposable test database name', () => {
    expect(
      assertDisposableTestDatabaseUrl(
        'postgresql://postgres:postgres@127.0.0.1:5432/ddl_tracker_test',
      ),
    ).toContain('/ddl_tracker_test');

    for (const unsafe of [
      'postgresql://postgres:postgres@127.0.0.1:5432/ddl_tracker',
      'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
      'https://127.0.0.1/ddl_tracker_test',
      'not-a-url',
    ]) {
      expect(() => assertDisposableTestDatabaseUrl(unsafe)).toThrow();
    }
  });
});
