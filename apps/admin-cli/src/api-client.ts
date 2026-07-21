import {
  apiErrorSchema,
  catalogApplyResponseSchema,
  catalogImportStatusSchema,
  catalogPlanBatchResponseSchema,
  type CatalogApplyRequest,
  type CatalogPlanBatchRequest,
} from '@ddl-tracker/contracts';
import type { z } from 'zod';

export class AdminApiError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly retryAfter: number | undefined;
  readonly requestId: string;
  readonly status: number;

  constructor(options: {
    code: string;
    details: Record<string, unknown>;
    message: string;
    retryable: boolean;
    retryAfter?: number;
    requestId: string;
    status: number;
  }) {
    super(options.message);
    this.name = 'AdminApiError';
    this.code = options.code;
    this.details = options.details;
    this.retryable = options.retryable;
    this.retryAfter = options.retryAfter;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export class AdminApiClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetcher: typeof fetch;

  constructor(options: {
    baseUrl: string;
    token: string;
    fetcher?: typeof fetch;
  }) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.#token = options.token;
    this.#fetcher = options.fetcher ?? fetch;
  }

  planBatch(request: CatalogPlanBatchRequest) {
    return this.#request(
      '/api/v1/admin/catalog/imports/plan',
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
      catalogPlanBatchResponseSchema,
    );
  }

  applyBatch(importId: string, request: CatalogApplyRequest) {
    return this.#request(
      `/api/v1/admin/catalog/imports/${encodeURIComponent(importId)}/apply`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
      catalogApplyResponseSchema,
    );
  }

  getStatus(importId: string) {
    return this.#request(
      `/api/v1/admin/catalog/imports/${encodeURIComponent(importId)}`,
      { method: 'GET' },
      catalogImportStatusSchema,
    );
  }

  async #request<Output>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<Output>,
  ): Promise<Output> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.#token}`);
    headers.set('accept', 'application/json');
    if (init.body !== undefined) {
      headers.set('content-type', 'application/json; charset=utf-8');
    }

    const response = await this.#fetcher(`${this.#baseUrl}${path}`, {
      ...init,
      headers,
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`API returned non-JSON status ${String(response.status)}.`, {
        cause: error,
      });
    }

    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          `API returned an invalid error envelope with status ${String(response.status)}.`,
        );
      }
      throw new AdminApiError({
        code: parsed.data.code,
        details: parsed.data.details,
        message: parsed.data.message,
        retryable: parsed.data.retryable,
        ...(parsed.data.retry_after === undefined
          ? {}
          : { retryAfter: parsed.data.retry_after }),
        requestId: parsed.data.request_id,
        status: response.status,
      });
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error('API response failed validation.', {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}
