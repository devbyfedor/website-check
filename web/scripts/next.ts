// Runs the Next.js command line with telemetry switched off, so that `next build` and `next dev`
// send nothing to telemetry.nextjs.org. The machine-wide setting (`next telemetry disable`) is left alone.
//
// node scripts/next.ts build | dev | ...
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
