import type { AuthenticatedPrincipal } from '../auth/account-service.js';
import { HttpError } from './errors.js';

export function readBearerToken(authorization: string | undefined): string {
  if (authorization === undefined) {
    throw unauthenticated();
  }
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(authorization);
  if (match?.[1] === undefined) {
    throw unauthenticated();
  }
  return match[1];
}

export async function authenticateBearer(
  authorization: string | undefined,
  authenticate: (token: string) => Promise<AuthenticatedPrincipal>,
): Promise<AuthenticatedPrincipal> {
  return authenticate(readBearerToken(authorization));
}

function unauthenticated(): HttpError {
  return new HttpError({
    code: 'unauthenticated',
    message: 'Authentication is required.',
    status: 401,
  });
}
