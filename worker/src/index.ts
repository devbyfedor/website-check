import app from './app.ts';

/**
 * Cloudflare Worker entry point of Website-Check DE: the API and the hourly cleanup (`app.ts`), and the
 * Durable Object that runs the scan queue and the browser in the EU jurisdiction (`queue/object.ts`,
 * session A5 part 3). Not deployed before stage C.
 */

export { ScanQueueObject } from './queue/object.ts';
export type { Env } from './app.ts';
export default app;
