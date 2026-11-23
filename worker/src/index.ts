import app from './app.ts';

/**
 * Entry point of the API Worker of Website-Check DE (`worker/wrangler.jsonc`): the API and the hourly
 * cleanup (`app.ts`). Since session A5 part 4 it carries no Durable Object, no Puppeteer, no axe-core and
 * no rules data: the scan queue with the browser is a Worker of its own (`scan-worker.ts`,
 * `worker/wrangler.scanner.jsonc`), reached through the Durable Object binding `SCAN_QUEUE` with
 * `script_name`. Reason in `docs/decisions.md` (A5 part 4). Not deployed before stage C.
 */

export type { Env } from './app.ts';
export default app;
