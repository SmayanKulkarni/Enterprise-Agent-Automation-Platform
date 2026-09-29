import type { NormalizedError, NormalizedErrorCategory } from '../../contracts/src/index.js';

interface CodeSpec { status: number; category: NormalizedErrorCategory; message: string }

const REJECTED = 'Request was not accepted.';
export const ERROR_CODES = {
  UNAUTHENTICATED: { status: 401, category: 'denied', message: 'Authentication is required.' },
  DENIED: { status: 403, category: 'denied', message: REJECTED },
  TENANT_MISMATCH: { status: 403, category: 'denied', message: REJECTED },
  INVALID_IDENTIFIER: { status: 403, category: 'denied', message: REJECTED },
  NOT_FOUND: { status: 404, category: 'invalid', message: 'Route was not found.' },
  CONFLICT: { status: 409, category: 'conflict', message: 'Request conflicts with current state.' },
  STALE: { status: 409, category: 'conflict', message: 'Request conflicts with current state.' },
  INVALID: { status: 422, category: 'invalid', message: REJECTED },
  INVALID_REQUEST: { status: 422, category: 'invalid', message: REJECTED },
  INVALID_PAGE_SIZE: { status: 422, category: 'invalid', message: REJECTED },
  INVALID_CURSOR: { status: 422, category: 'invalid', message: REJECTED },
  INVALID_BROWSER_COMMAND: { status: 422, category: 'invalid', message: REJECTED },
  INVALID_JSON: { status: 400, category: 'invalid', message: 'Request body is not valid JSON.' },
  FEATURE_NOT_READY: { status: 501, category: 'terminal', message: 'This feature is not ready.' },
  PROJECTION_UNAVAILABLE: { status: 503, category: 'terminal', message: 'Projection is unavailable.' },
  UNAVAILABLE: { status: 503, category: 'retryable', message: 'Service is temporarily unavailable.' },
  UPSTREAM_TIMEOUT: { status: 504, category: 'timeout', message: 'An upstream service timed out.' },
  INTERNAL: { status: 500, category: 'terminal', message: 'The request could not be completed.' },
} as const satisfies Record<string, CodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;
export const isErrorCode = (value: unknown): value is ErrorCode => typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);

export class AppError extends Error {
  readonly status: number;
  readonly category: NormalizedErrorCategory;
  reported = false;

  constructor(readonly code: ErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'AppError';
    this.status = ERROR_CODES[code].status;
    this.category = ERROR_CODES[code].category;
  }

  toBody(): NormalizedError {
    return { category: this.category, code: this.code, message: ERROR_CODES[this.code].message, redacted: true };
  }
}
