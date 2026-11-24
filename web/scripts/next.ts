// Runs the Next.js command line with telemetry switched off, so that `next build` and `next dev`
// send nothing to telemetry.nextjs.org. The machine-wide setting (`next telemetry disable`) is left alone.
//
// node scripts/next.ts build | dev | ...
// node scripts/next.ts build --examples   also builds the example pages for the checks (WC_EXAMPLES=1)
//
// A build without --examples is the production build: it fails when the data of an example page
// (the example scan of the reference, components/scan/example-scan.ts) is found in web/out, so a
// visitor can never get the example in place of their own scan.
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const OUT_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'out');
// A string that only the example data contains: the fictional shop of the reference.
const EXAMPLE_MARKER = 'roesterei-muster';

const args = process.argv.slice(2);
const examples = args.includes('--examples');
const nextArgs = args.filter((a) => a !== '--examples');

// The example pages live under a path part "beispiel" (session B2 part 3: /pruefung/beispiel, its states, and
// /beispiel/formular/…); no file of the production build may have one.
const EXAMPLE_PATH = /(^|[\\/])beispiel([\\/.]|$)/;

async function filesWithMarker(dir: string): Promise<string[]> {
  const hits: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name);
    if (EXAMPLE_PATH.test(relative(OUT_DIR, path))) {
      hits.push(`${relative(OUT_DIR, path)} (an example page)`);
      continue;
    }
    if (!entry.isFile() || !/\.(html|js|txt|json|css)$/.test(entry.name)) continue;
    if ((await readFile(path, 'utf8')).includes(EXAMPLE_MARKER)) hits.push(relative(OUT_DIR, path));
  }
  return hits;
}

const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', WC_EXAMPLES: examples ? '1' : '0' },
});
child.on('exit', async (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  if (code === 0 && nextArgs[0] === 'build' && !examples) {
    const hits = await filesWithMarker(OUT_DIR);
    if (hits.length) {
      console.error(`The production build contains the example data ("${EXAMPLE_MARKER}") in: ${hits.join(', ')}`);
      process.exit(1);
    }
    console.log(`Production build: no example page and no example data in web/out (searched for "beispiel" in the paths and "${EXAMPLE_MARKER}" in the files).`);
  }
  process.exit(code ?? 1);
});
