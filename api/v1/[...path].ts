import '../../packages/telemetry/src/browser-api.js';
import { waitUntil } from '@vercel/functions';
import { browserResponse } from '../../packages/browser/src/browser-response.js';
import { flushTelemetry } from '../../packages/telemetry/src/index.js';

export default {
  fetch: async (request: Request) => {
    try { return await browserResponse(request); } finally { waitUntil(flushTelemetry()); }
  },
};
