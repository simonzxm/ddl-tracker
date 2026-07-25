import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  apiCompatibilityMatrixSchema,
} from '../src/api-compatibility.js';

const rawMatrix: unknown = JSON.parse(
  readFileSync(
    new URL('../vectors/api-compatibility-v1.1.json', import.meta.url),
    'utf8',
  ),
);

describe('API compatibility matrix', () => {
  it('publishes a valid matrix for the current contract', () => {
    const matrix = apiCompatibilityMatrixSchema.parse(rawMatrix);

    expect(matrix.current_server_version).toBe(API_CONTRACT_VERSION);
  });

  it('covers every supported client and server version pair once', () => {
    const matrix = apiCompatibilityMatrixSchema.parse(rawMatrix);
    const pairs = matrix.matrix.map(
      ({ client_version: client, server_version: server }) =>
        `${client}->${server}`,
    );

    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs.sort()).toEqual([
      '1.0.0->1.0.0',
      '1.0.0->1.1.0',
      '1.1.0->1.0.0',
      '1.1.0->1.1.0',
    ]);
  });

  it('requires explicit fallbacks across minor versions', () => {
    const matrix = apiCompatibilityMatrixSchema.parse(rawMatrix);
    const oldClient = matrix.matrix.find(
      ({ client_version: client, server_version: server }) =>
        client === '1.0.0' && server === '1.1.0',
    );
    const oldServer = matrix.matrix.find(
      ({ client_version: client, server_version: server }) =>
        client === '1.1.0' && server === '1.0.0',
    );

    expect(oldClient).toMatchObject({
      compatibility: 'conditional',
      requirements: expect.arrayContaining([
        'ignore_additive_response_fields',
        'accept_new_terminal_statuses',
      ]),
    });
    expect(oldServer).toMatchObject({
      compatibility: 'conditional',
      requirements: expect.arrayContaining([
        'fallback_to_plan_batches',
        'avoid_1_1_only_endpoints',
      ]),
    });
  });
});
