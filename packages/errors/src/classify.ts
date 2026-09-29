import { AppError, isErrorCode, type ErrorCode } from './app-error.js';

const CONNECTION = new Set(['ESOCKET', 'ELOGIN', 'ECONNCLOSED', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const TIMEOUT = new Set(['ETIMEOUT', 'ETIMEDOUT']);

export const codeOf = (error: unknown): unknown => error instanceof Error && 'code' in error ? error.code : undefined;

function codeFor(error: unknown): ErrorCode {
  if (!(error instanceof Error)) return 'INTERNAL';
  const code = codeOf(error);
  if (isErrorCode(code)) return code;
  if (isErrorCode(error.message)) return error.message;
  if (typeof code === 'string' && TIMEOUT.has(code) || error.name === 'TimeoutError') return 'UPSTREAM_TIMEOUT';
  if (typeof code === 'string' && CONNECTION.has(code)) return 'UNAVAILABLE';
  if (error.name === 'ContractValidationError' || typeof code === 'string' && (code.startsWith('INVALID_') || code === 'UNSUPPORTED_COMMAND')) return 'INVALID';
  return 'INTERNAL';
}

export function classify(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError(codeFor(error), { cause: error });
}
