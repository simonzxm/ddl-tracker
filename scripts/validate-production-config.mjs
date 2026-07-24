import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const relativePath =
  process.env.WRANGLER_PRODUCTION_CONFIG ??
  'apps/api/wrangler.production.jsonc';
const path = resolve(root, relativePath);

let config;
try {
  config = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  throw new Error(`Unable to read valid JSON production config at ${relativePath}.`, {
    cause: error,
  });
}

const errors = [];
const vars = config.vars ?? {};
const hyperdrive = Array.isArray(config.hyperdrive) ? config.hyperdrive : [];
const hyperdriveId = hyperdrive[0]?.id;

if (config.main !== 'src/index.ts') errors.push('main must be src/index.ts');
if (!config.compatibility_flags?.includes('nodejs_compat')) {
  errors.push('nodejs_compat compatibility flag is required');
}
if (
  !Number.isInteger(config.limits?.cpu_ms) ||
  config.limits.cpu_ms < 1_000 ||
  config.limits.cpu_ms > 30_000
) {
  errors.push('limits.cpu_ms must be an integer from 1000 through 30000');
}
if (vars.APP_ENVIRONMENT !== 'production') {
  errors.push('APP_ENVIRONMENT must be production');
}
if (
  typeof vars.ALLOWED_EMAIL_DOMAINS !== 'string' ||
  vars.ALLOWED_EMAIL_DOMAINS.includes('example')
) {
  errors.push('ALLOWED_EMAIL_DOMAINS must contain real institutional domains');
}
if (
  typeof vars.SMTP_FROM_ADDRESS !== 'string' ||
  vars.SMTP_FROM_ADDRESS.includes('example')
) {
  errors.push('SMTP_FROM_ADDRESS must be a real sender address');
}
if (vars.SMTP_PORT !== '465' && vars.SMTP_PORT !== '587') {
  errors.push('SMTP_PORT must be 465 or 587');
}
if (
  typeof hyperdriveId !== 'string' ||
  !/^[0-9a-f]{32}$/u.test(hyperdriveId) ||
  /^0+$/u.test(hyperdriveId)
) {
  errors.push('HYPERDRIVE id must be a non-placeholder 32-character hex ID');
}
if (!config.observability?.enabled || !config.observability?.logs?.enabled) {
  errors.push('Workers observability and logs must be enabled');
}
if (!Array.isArray(config.triggers?.crons) || config.triggers.crons.length === 0) {
  errors.push('retention cleanup cron must be configured');
}

if (errors.length > 0) {
  throw new Error(`Production config is not deployable:\n- ${errors.join('\n- ')}`);
}

globalThis.console.log(`Production config validated: ${relativePath}`);
