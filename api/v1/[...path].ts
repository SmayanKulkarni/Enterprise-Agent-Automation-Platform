import { browserResponse } from '../../packages/browser/src/browser-response.js';

export default { fetch: (request: Request) => browserResponse(request) };
