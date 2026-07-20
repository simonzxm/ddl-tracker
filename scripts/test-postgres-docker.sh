#!/bin/sh
set -eu

container_name="ddl-tracker-postgres-test"
port="${DDL_TRACKER_TEST_POSTGRES_PORT:-55432}"
connection="postgresql://postgres:postgres@127.0.0.1:${port}/ddl_tracker_test"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker run -d --rm \
  --name "$container_name" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ddl_tracker_test \
  -p "${port}:5432" \
  postgres:17-alpine >/dev/null

until docker exec "$container_name" pg_isready -U postgres -d ddl_tracker_test >/dev/null 2>&1; do
  sleep 1
done

TEST_DATABASE_URL="$connection" pnpm test:postgres
