/**
 * Entry point of the scan Worker of Website-Check DE (`worker/wrangler.scanner.jsonc`, session A5 part 4):
 * only the Durable Object `ScanQueueObject` with the queue, the browser (Puppeteer and Browser Run),
 * axe-core, the rules data and the analyzers. It has no public address (`workers_dev: false`, no route);
 * the API Worker reaches the object through its Durable Object binding with `script_name`. Its own fetch
 * handler answers nothing. Not deployed before stage C.
 */

export { ScanQueueObject } from './queue/object.ts';

export default {
  fetch: (): Response => new Response(null, { status: 404 }),
} satisfies ExportedHandler;
