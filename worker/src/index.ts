import { createDohResolver, createUrlGuard } from '@website-check/scanner';
import { createApi } from './api/router.ts';

/**
 * Cloudflare Worker entry point (session A5 part 2): the API with D1. The Durable Object that runs the
 * queue and the browser comes in part 3; until then a started scan stays queued. Not deployed before
 * stage C.
 */

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One guard per request: a scan start resolves the visitor's address once (two DNS-over-HTTPS subrequests).
    const guard = createUrlGuard({ resolve: createDohResolver() });
    const api = createApi({ db: env.DB, check: (url) => guard.check(url) });
    return api(request);
  },
} satisfies ExportedHandler<Env>;
