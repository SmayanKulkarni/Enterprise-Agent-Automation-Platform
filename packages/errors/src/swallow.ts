import { report } from './report.js';

export const reported = <T>(fallback: T, site: string) => (error: unknown): T => { report(error, { site }); return fallback; };
