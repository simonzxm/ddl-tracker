import { HttpError } from '../http/errors.js';
import { constantTimeEqual } from '../auth/primitives.js';

export interface MaintainerBootstrapRepository {
  bootstrap(input: {
    actorId: string;
    requestId: string;
  }): Promise<{ maintainer: true }>;
}

export class MaintainerAccessService {
  readonly #repository: MaintainerBootstrapRepository;
  readonly #bootstrapToken: string;

  constructor(
    repository: MaintainerBootstrapRepository,
    bootstrapToken: string,
  ) {
    this.#repository = repository;
    this.#bootstrapToken = bootstrapToken;
  }

  async bootstrap(input: {
    actorId: string;
    requestId: string;
    bootstrapToken: string;
  }): Promise<{ maintainer: true }> {
    if (!constantTimeEqual(this.#bootstrapToken, input.bootstrapToken)) {
      throw new HttpError({
        code: 'forbidden',
        message: 'Maintainer bootstrap is not authorized.',
        status: 403,
      });
    }
    return this.#repository.bootstrap({
      actorId: input.actorId,
      requestId: input.requestId,
    });
  }
}
