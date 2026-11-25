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
import { STAGE_D_MARKERS } from '../lib/report-stage-d-texts.ts';
import { writeHeaders } from './security-headers.ts';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const OUT_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'out');
// A string that only the example data contains: the fictional shop of the reference. Session B4 part 1: also the texts
// that only the parts of stage D have (the "Revisionen" and the "Arbeitsauftrag"), which only the example page shows.
const EXAMPLE_MARKER = 'roesterei-muster';
const MARKERS: readonly string[] = [EXAMPLE_MARKER, ...STAGE_D_MARKERS];

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
    const text = await readFile(path, 'utf8');
    const found = MARKERS.filter((m) => text.includes(m));
    if (found.length) hits.push(`${relative(OUT_DIR, path)} (${found.join(', ')})`);
  }
  return hits;
}

const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', WC_EXAMPLES: examples ? '1' : '0' },
});
child.on('exit', async (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  // Session B5 part 2: the headers of the pages, with the CSP of each (security-headers.ts), after every build.
  if (code === 0 && nextArgs[0] === 'build') {
    const h = await writeHeaders(OUT_DIR);
    console.log(`Headers of the pages: web/out/_headers, ${h.pages} pages, ${h.rules} rules, longest line ${h.longest} characters.`);
    if (h.problems.length > 0) {
      if (!examples) {
        console.error(`The production build breaks a limit of Workers Static Assets: ${h.problems.join('; ')}`);
        process.exit(1);
      }
      console.log(`  The example build is never deployed; beyond the limits of Workers Static Assets: ${h.problems.join('; ')}`);
    }
  }
  if (code === 0 && nextArgs[0] === 'build' && !examples) {
    const hits = await filesWithMarker(OUT_DIR);
    if (hits.length) {
      console.error(`The production build contains the example data or a text of stage D in: ${hits.join(', ')}`);
      process.exit(1);
    }
    console.log(`Production build: no example page, no example data and no text of stage D in web/out (searched for "beispiel" in the paths and ${MARKERS.map((m) => `"${m}"`).join(', ')} in the files).`);
  }
  process.exit(code ?? 1);
});
