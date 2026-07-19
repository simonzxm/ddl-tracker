import type { ApiError, ApiErrorCode } from '@ddl-tracker/contracts';

export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly retryAfter: number | undefined;
  readonly status: number;

  constructor(options: {
    code: ApiErrorCode;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    retryable?: boolean;
    retryAfter?: number;
  }) {
    super(options.message);
    this.name = 'HttpError';
    this.code = options.code;
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.status = options.status;
  }
}

export function toApiError(error: HttpError, requestId: string): ApiError {
  return {
    code: error.code,
    details: error.details,
    message: error.message,
    retryable: error.retryable,
    ...(error.retryAfter === undefined
      ? {}
      : { retry_after: error.retryAfter }),
    request_id: requestId,
  };
}
