export const MAX_TIMER_MS = 5 * 86400000;
export const APPROVAL_MAX_TIMEOUT_MS = 14 * 86400000;
export const nextTimerAt = (now: number, deadline: number): number => Math.min(deadline, now + MAX_TIMER_MS);
