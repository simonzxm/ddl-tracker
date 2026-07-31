import process from 'node:process';

const rawBaseUrl = process.env.DDL_TRACKER_BASE_URL;
if (rawBaseUrl === undefined || rawBaseUrl.length === 0) {
  throw new Error('DDL_TRACKER_BASE_URL is required.');
}
const baseUrl = rawBaseUrl.replace(/\/+$/u, '');
if (!baseUrl.startsWith('https://') && process.env.ALLOW_HTTP_SMOKE !== '1') {
  throw new Error('Smoke tests require HTTPS unless ALLOW_HTTP_SMOKE=1 is set.');
}
const token = process.env.DDL_TRACKER_SMOKE_TOKEN;

async function request(path, init = {}) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    ...init,
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${path} returned non-JSON status ${String(response.status)}.`);
    }
  }
  return { response, body };
}

function expectStatus(path, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${path} returned ${String(actual)}; expected ${String(expected)}.`);
  }
}

const live = await request('/api/health/live');
expectStatus('/api/health/live', live.response.status, 200);
if (live.body?.status !== 'live') throw new Error('/api/health/live payload is invalid.');

const ready = await request('/api/health/ready');
expectStatus('/api/health/ready', ready.response.status, 200);
if (ready.body?.status !== 'ready') throw new Error('/api/health/ready payload is invalid.');

const openapi = await request('/api/openapi.json');
expectStatus('/api/openapi.json', openapi.response.status, 200);
if (openapi.body?.openapi !== '3.1.0') throw new Error('OpenAPI document is invalid.');

const invalidAuth = await request('/api/v1/auth/oidc/start', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ redirect_uri: '/not-an-absolute-callback' }),
});
expectStatus('/api/v1/auth/oidc/start', invalidAuth.response.status, 400);
if (invalidAuth.body?.code !== 'invalid_request') {
  throw new Error('Invalid OIDC redirect did not return invalid_request.');
}

if (token !== undefined && token.length > 0) {
  const headers = { authorization: `Bearer ${token}` };
  const terms = await request('/api/v1/terms', { headers });
  expectStatus('/api/v1/terms', terms.response.status, 200);
  if (!Array.isArray(terms.body?.terms)) throw new Error('Terms response is invalid.');

  const snapshot = await request('/api/v1/sync', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      protocol_version: 2,
      mode: 'account_snapshot',
      snapshot_token: null,
      page_token: null,
      snapshot_limit: 10,
      operations: [],
    }),
  });
  expectStatus('/api/v1/sync', snapshot.response.status, 200);
  if (snapshot.body?.mode !== 'account_snapshot') {
    throw new Error('Account snapshot response is invalid.');
  }
}

globalThis.console.log(`Smoke checks passed for ${baseUrl}.`);
