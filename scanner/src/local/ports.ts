import { createServer, type Server } from 'node:net';

/**
 * Session C0 part 2: the bad ports of the Fetch standard (https://fetch.spec.whatwg.org/#bad-port) from 1024 on.
 * Chrome refuses to load an address on one of them (`net::ERR_UNSAFE_PORT`; the Chromium of Playwright 1.65 all but
 * 4190 and 6679, which the standard added last) and the fetch of Node (undici) refuses to connect to any of them
 * ("fetch failed", cause "bad port"), both before any connection. A server on one of them cannot be reached.
 *
 * The operating system gives a server that asks for any free port (port 0) a port of its dynamic range. On Windows
 * that range is 49152 to 65535 by default, where no bad port lies; on this laptop it is 1024 to 15000 (`netsh int ipv4
 * show dynamicport tcp`), which holds all 19 ports below. So every test server, check server and local runtime of
 * wrangler (workerd and Miniflare bind port 0 and Miniflare then talks to workerd with undici's fetch) could get one:
 * the final run of C0 lost 34 of 36 tests of the CDP capture that way (every page `net::ERR_UNSAFE_PORT`), and the
 * D1 migrations of wrangler answer "fetch failed" when their local runtime gets one. Ports below 1024 are never given
 * out for port 0.
 */
export const BAD_PORTS: readonly number[] = [1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080];

export const isBadPort = (port: number): boolean => BAD_PORTS.includes(port);

/** The loopback addresses our servers, workerd, Miniflare and the debugging port of Chrome bind to. */
const HOSTS = ['127.0.0.1', '::1'] as const;

export interface BadPortHold {
  /** The ports this hold keeps bound, as "127.0.0.1:5060" and "[::1]:5060". */
  held: string[];
  /**
   * The ports it could not bind, with the reason: in use by another socket (then the operating system does not give
   * them out either while that socket lives), or the address does not exist (no IPv6 loopback).
   */
  notHeld: string[];
  release(): Promise<void>;
}

/**
 * Keeps every bad port from 1024 on bound on the loopback addresses, IPv4 and IPv6, until `release` or the end of the
 * process, so the operating system cannot give one of them to anything that asks for port 0 meanwhile, in this process
 * or any other: our test and check servers, the local runtime of wrangler, the debugging port of Chrome. The servers
 * accept no connection that matters (nothing connects to a bad port) and do not keep the process alive.
 *
 * Used by the global setup of `npm test` and of both integration configs (`scanner/test/support/hold-bad-ports.ts`),
 * by the static server of the web checks and by the dev site (`web/scripts/static-server.ts`, `web/scripts/dev-local.ts`).
 * A second hold while one lives holds nothing and costs nothing: the ports are taken already.
 */
export async function holdBadPorts(): Promise<BadPortHold> {
  const servers: Server[] = [];
  const held: string[] = [];
  const notHeld: string[] = [];
  for (const host of HOSTS) {
    for (const port of BAD_PORTS) {
      const name = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
      const server = createServer((socket) => socket.destroy());
      const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
        server.once('error', resolve);
        server.listen({ host, port, exclusive: true }, () => resolve(null));
      });
      if (error === null) {
        server.unref();
        servers.push(server);
        held.push(name);
      } else notHeld.push(`${name} (${error.code ?? error.message})`);
    }
  }
  return {
    held,
    notHeld,
    release: async () => {
      await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    },
  };
}
