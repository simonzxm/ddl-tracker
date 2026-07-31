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
const routes = Array.isArray(config.routes) ? config.routes : [];

if (config.main !== 'src/index.ts') errors.push('main must be src/index.ts');
if (!config.compatibility_flags?.includes('nodejs_compat')) {
  errors.push('nodejs_compat compatibility flag is required');
}
if (vars.APP_ENVIRONMENT !== 'production') {
  errors.push('APP_ENVIRONMENT must be production');
}
if (vars.OIDC_ISSUER !== 'https://auth.nju.at') {
  errors.push('OIDC_ISSUER must be https://auth.nju.at');
}
if (
  typeof vars.OIDC_CLIENT_ID !== 'string' ||
  !/^[A-Za-z0-9_-]{16,128}$/u.test(vars.OIDC_CLIENT_ID)
) {
  errors.push('OIDC_CLIENT_ID must be a non-placeholder public client ID');
}
if (
  vars.OIDC_REDIRECT_URI !==
  'https://ddl.nju.at/api/v1/auth/oidc/callback'
) {
  errors.push(
    'OIDC_REDIRECT_URI must use https://ddl.nju.at/api/v1/auth/oidc/callback',
  );
}
if (vars.OIDC_POST_LOGIN_REDIRECT_URIS !== 'https://ddl.nju.at/auth/callback') {
  errors.push(
    'OIDC_POST_LOGIN_REDIRECT_URIS must be the approved ddl.nju.at client callback',
  );
}
for (const removedName of [
  'ALLOWED_EMAIL_DOMAINS',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_FROM_ADDRESS',
  'SMTP_FROM_NAME',
]) {
  if (removedName in vars) errors.push(`${removedName} must be removed`);
}
if (
  routes.length !== 1 ||
  routes[0]?.pattern !== 'ddl.nju.at/api/*' ||
  routes[0]?.custom_domain === true
) {
  errors.push('routes must contain only ddl.nju.at/api/*');
}
if (JSON.stringify(config).includes('api.210023.xyz')) {
  errors.push('retired api.210023.xyz domain must not appear in production config');
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
