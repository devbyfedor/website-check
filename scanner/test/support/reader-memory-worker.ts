import { parentPort, workerData } from 'node:worker_threads';
import { snapshotFromHtml } from '../../src/quick/html-snapshot.ts';
import { HEAVY_HTML } from './heavy-html.ts';

/**
 * Worker of `reader-memory.test.ts` (session C2): loads the reader, warms its code on a small page (the queue object has
 * its code loaded before a check), then reads the pages named in `workerData.pages` one after the other, each built
 * right before it is read. Posts `{page}` before each page and `{done: true}` at the end; a page that needs more than
 * the worker's heap ends the worker with ERR_WORKER_OUT_OF_MEMORY after its `{page}` message.
 */

const port = parentPort;
if (port === null) throw new Error('not a worker');
const { pages } = workerData as { pages: string[] };
snapshotFromHtml('<!doctype html><html lang="de"><body><p>Willkommen <a href="/impressum">Impressum</a></p></body></html>', 'https://beispiel.de/', { platform: true });
for (const name of pages) {
  const make = HEAVY_HTML[name];
  if (make === undefined) throw new Error(`no page ${name}`);
  port.postMessage({ page: name });
  const started = performance.now();
  const snapshot = snapshotFromHtml(make(), 'https://beispiel.de/', { platform: true });
  port.postMessage({ read: name, ms: Math.round(performance.now() - started), elementsTruncated: snapshot.elementsTruncated === true });
}
port.postMessage({ done: true });
