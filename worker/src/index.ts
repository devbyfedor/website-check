import { createDohResolver, createUrlGuard } from '@website-check/scanner';
import { cleanupRateLimit } from './api/rate-limit.ts';
import { createApi } from './api/router.ts';

/**
 * Cloudflare Worker entry point (session A5 part 2): the API with D1, and an hourly cleanup of the rate
 * limit (cron trigger in `wrangler.jsonc`). The Durable Object that runs the queue and the browser comes in
 * part 3; until then a started scan stays queued. Not deployed before stage C.
 */

export interface Env {
  DB: D1Database;
  /** Key of the visitor hash of the rate limit, set by Fedor as a Worker secret (locally in `.dev.vars`). */
  RATE_LIMIT_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One guard per request: a scan start resolves the visitor's address once (two DNS-over-HTTPS subrequests).
    const guard = createUrlGuard({ resolve: createDohResolver() });
    const api = createApi({ db: env.DB, check: (url) => guard.check(url), secret: env.RATE_LIMIT_SECRET });
    return api(request);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await cleanupRateLimit(env.DB, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
