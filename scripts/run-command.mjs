import { spawnSync } from 'node:child_process';
import process from 'node:process';

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: createChildEnvironment(options.environment),
    maxBuffer: options.maxBuffer ?? 100 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
  if (result.error !== undefined) throw result.error;

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.status !== 0) {
    const combined = `${stdout}\n${stderr}`;
    const redacted = (options.redact ?? []).reduce(
      (value, secret) => value.replaceAll(secret, '[redacted]'),
      combined,
    );
    throw new Error(
      redacted.trim().length === 0
        ? (options.failureMessage ??
          `${command} exited with status ${String(result.status)}.`)
        : redacted.trim(),
    );
  }
  return { stdout, stderr };
}

export function createChildEnvironment(environment = process.env) {
  const childEnvironment = { ...environment, NO_COLOR: '1' };
  delete childEnvironment.DDL_TRACKER_MIGRATION_DATABASE_PASSWORD;
  return childEnvironment;
}
