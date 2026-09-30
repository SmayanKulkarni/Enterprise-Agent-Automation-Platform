export const SECRET = /(?:Bearer\s+|(?:api[-_]?key|token|secret|password|pwd|authorization)[=:]\s*)[^\s;,'"]+/giu;
const MAX_MESSAGE = 200;

export const scrub = (text: unknown, limit = MAX_MESSAGE): string => String(text).replace(SECRET, '[redacted]').slice(0, limit);
