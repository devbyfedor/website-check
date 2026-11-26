import { createServer, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { BAD_PORTS, holdBadPorts, isBadPort } from '../src/local/ports.ts';

// Session C0 part 2: the cause of the failures of the integration tests in three sessions was a port the operating
// system gave a test server (its dynamic range here is 1024 to 15000) and that Chrome and the fetch of Node refuse.
// npm run test:integration shows the side of Chrome (scanner/test/integration/bad-ports.test.ts).

type Listened = { server: Server; port: number } | { error: NodeJS.ErrnoException };

const listen = (port: number, host = '127.0.0.1'): Promise<Listened> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve({ error }));
    server.listen({ port, host, exclusive: true }, () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
const close = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

describe('the bad ports (session C0 part 2)', () => {
  it('the fetch of Node refuses each of them before any connection, with the cause "bad port"', async () => {
    expect(BAD_PORTS).toHaveLength(19);
    for (const port of BAD_PORTS) {
      const error = await fetch(`http://127.0.0.1:${port}/`).then(
        () => null,
        (e: unknown) => e as { cause?: { message?: string } },
      );
      expect(error?.cause?.message, String(port)).toBe('bad port');
    }
    expect(isBadPort(5060)).toBe(true);
    expect(isBadPort(5062)).toBe(false);
  });

  it('while a hold lives none of them can be bound on 127.0.0.1 or ::1, and 300 servers on port 0 get none of them', async () => {
    const hold = await holdBadPorts();
    try {
      // Under npm test the global setup holds them already: then this hold holds nothing and each is in use.
      expect(hold.held.length + hold.notHeld.length).toBe(2 * BAD_PORTS.length);
      for (const host of ['127.0.0.1', '::1']) {
        for (const port of BAD_PORTS) {
          const got = await listen(port, host);
          if ('server' in got) {
            await close(got.server);
            throw new Error(`${host} ${port} could be bound while held`);
          }
          expect(got.error.code, `${host} ${port}`).toMatch(/^(EADDRINUSE|EACCES|EADDRNOTAVAIL)$/);
        }
      }
      const given: number[] = [];
      for (let i = 0; i < 300; i += 1) {
        const got = await listen(0);
        if (!('server' in got)) throw got.error;
        given.push(got.port);
        await close(got.server);
      }
      expect(given.filter(isBadPort)).toEqual([]);
    } finally {
      await hold.release();
    }
    // What this hold held is free again after release.
    for (const name of hold.held) {
      const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(name)!;
      const got = await listen(Number(m[2]), m[1]);
      if (!('server' in got)) throw new Error(`${name} still taken after release: ${got.error.code}`);
      await close(got.server);
    }
  });
});
