// Serves the static export (web/out) on this computer only, to look at the built site in a browser.
//
//   npm run preview            builds web/ first, then serves http://127.0.0.1:3000/
//   node web/scripts/serve.ts [--port 3000]
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './static-server.ts';

const OUT_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'out');

const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 3000;

try {
  await stat(join(OUT_DIR, 'index.html'));
} catch {
  console.error('web/out is missing: run `npm run build:web` first (or `npm run preview`, which builds).');
  process.exit(1);
}

const server = await startStaticServer([{ prefix: '/', dir: OUT_DIR }], {
  port,
  notFoundFile: join(OUT_DIR, '404.html'),
});
console.log(`The built site: ${server.origin}/   (stop with Ctrl+C)`);
