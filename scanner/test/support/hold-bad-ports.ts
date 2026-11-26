import { holdBadPorts } from '../../src/local/ports.ts';

/**
 * Session C0 part 2: the global setup of `npm test` and of both integration configs. While the tests run, no server
 * that asks for port 0 (a fixture, the local runtime of wrangler, the debugging port of Chrome) can get a port that
 * Chrome and the fetch of Node refuse (`scanner/src/local/ports.ts`).
 */
export default async function setup(): Promise<() => Promise<void>> {
  const hold = await holdBadPorts();
  // Only a port in use elsewhere is worth a line: the operating system does not give it out either.
  if (hold.notHeld.length > 0) console.log(`bad ports held: ${hold.held.length}; not held: ${hold.notHeld.join(', ')}`);
  return () => hold.release();
}
