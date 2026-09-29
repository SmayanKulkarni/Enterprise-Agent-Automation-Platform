import { PlatformApiError, describeError, withRef, type ErrorKind } from './platform-api.js';

export type ErrorViewKind = ErrorKind | 'timeout' | 'not-ready';

export interface ErrorView {
  kind: ErrorViewKind;
  title: string;
  message: string;
  retryable: boolean;
}

const views: Record<ErrorViewKind, Omit<ErrorView, 'kind'>> = {
  'signed-out': { title: 'Sign in required', message: 'Your session ended. Sign in to continue.', retryable: false },
  denied: { title: 'Access denied', message: "Your account can't do that in this workspace.", retryable: false },
  'not-found': { title: 'Not found', message: 'That item no longer exists or was moved.', retryable: false },
  conflict: { title: 'Out of date', message: 'This changed since you loaded it. Refresh, then try again.', retryable: false },
  invalid: { title: 'Check your input', message: "The request wasn't valid. Review it and try again.", retryable: false },
  'rate-limited': { title: 'Slow down', message: 'Too many requests. Wait a moment, then try again.', retryable: true },
  unknown: { title: 'Result unknown', message: "We couldn't confirm the outcome. Refresh before trying again.", retryable: false },
  unavailable: { title: 'Service unavailable', message: 'Something on our side failed. Try again shortly.', retryable: true },
  timeout: { title: 'Took too long', message: "The service didn't answer in time. Try again.", retryable: true },
  'not-ready': { title: 'Not available yet', message: "This feature isn't enabled in your workspace yet.", retryable: false },
};

function kindOf(error: unknown, write: boolean): ErrorViewKind {
  if (error instanceof PlatformApiError) {
    if (error.code === 'UPSTREAM_TIMEOUT' || error.status === 504) return 'timeout';
    if (error.code === 'FEATURE_NOT_READY' || error.status === 501) return 'not-ready';
  }
  return describeError(error, { write });
}

export function errorView(error: unknown, { write = false }: { write?: boolean } = {}): ErrorView {
  const kind = kindOf(error, write);
  return { kind, ...views[kind] };
}

export function failureNotice(error: unknown, context: string, options?: { write?: boolean }): string {
  return withRef(`${context} ${errorView(error, options).message}`, error);
}
