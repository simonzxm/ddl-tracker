import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  apiCompatibilityMatrixSchema,
} from '../src/api-compatibility.js';

const rawMatrix: unknown = JSON.parse(
  readFileSync(
    new URL('../vectors/api-compatibility-v4.0.json', import.meta.url),
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
      '1.0.0->2.0.0',
      '1.0.0->3.0.0',
      '1.0.0->4.0.0',
      '1.1.0->1.0.0',
      '1.1.0->1.1.0',
      '1.1.0->2.0.0',
      '1.1.0->3.0.0',
      '1.1.0->4.0.0',
      '2.0.0->1.0.0',
      '2.0.0->1.1.0',
      '2.0.0->2.0.0',
      '2.0.0->3.0.0',
      '2.0.0->4.0.0',
      '3.0.0->1.0.0',
      '3.0.0->1.1.0',
      '3.0.0->2.0.0',
      '3.0.0->3.0.0',
      '3.0.0->4.0.0',
      '4.0.0->1.0.0',
      '4.0.0->1.1.0',
      '4.0.0->2.0.0',
      '4.0.0->3.0.0',
      '4.0.0->4.0.0',
    ]);
  });

  it('records strict-client incompatibility and an explicit legacy workflow', () => {
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
      compatibility: 'incompatible',
      requirements: [],
    });
    expect(oldServer).toMatchObject({
      compatibility: 'conditional',
      requirements: expect.arrayContaining([
        'select_legacy_plan_workflow',
        'avoid_1_1_only_endpoints',
      ]),
    });

    expect(
      matrix.matrix.find(
        ({ client_version: client, server_version: server }) =>
          client === '1.1.0' && server === '2.0.0',
      ),
    ).toMatchObject({ compatibility: 'incompatible', requirements: [] });
    expect(
      matrix.matrix.find(
        ({ client_version: client, server_version: server }) =>
          client === '2.0.0' && server === '3.0.0',
      ),
    ).toMatchObject({ compatibility: 'incompatible', requirements: [] });
    expect(
      matrix.matrix.find(
        ({ client_version: client, server_version: server }) =>
          client === '3.0.0' && server === '3.0.0',
      ),
    ).toMatchObject({ compatibility: 'full', requirements: [] });
    expect(
      matrix.matrix.find(
        ({ client_version: client, server_version: server }) =>
          client === '3.0.0' && server === '4.0.0',
      ),
    ).toMatchObject({ compatibility: 'incompatible', requirements: [] });
    expect(
      matrix.matrix.find(
        ({ client_version: client, server_version: server }) =>
          client === '4.0.0' && server === '4.0.0',
      ),
    ).toMatchObject({ compatibility: 'full', requirements: [] });
  });
});
