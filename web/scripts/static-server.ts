// A small static file server on 127.0.0.1 for the visual check: the static export of the app at `/`,
// the design reference at `/__reference/` and the self-hosted font files at `/__fonts/`.
// Development tool only; production is served by Workers Static Assets.
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface Mount {
  prefix: string; // '/' or '/__name/'
  dir: string;
}

export interface StaticServer {
  origin: string;
  close(): Promise<void>;
}

async function fileAt(path: string): Promise<string | null> {
  try {
    const s = await stat(path);
    if (s.isFile()) return path;
    if (s.isDirectory()) return fileAt(join(path, 'index.html'));
  } catch {
    // not found
  }
  return null;
}

async function resolve(mounts: Mount[], urlPath: string): Promise<{ file: string; mount: Mount } | null> {
  // Longest prefix first, so '/__reference/' wins over '/'.
  const sorted = [...mounts].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const mount of sorted) {
    if (!urlPath.startsWith(mount.prefix)) continue;
    const rel = decodeURIComponent(urlPath.slice(mount.prefix.length));
    const target = normalize(join(mount.dir, rel));
    if (target !== mount.dir && !target.startsWith(mount.dir + sep)) return null;
    const file = (await fileAt(target)) ?? (extname(target) === '' ? await fileAt(`${target}.html`) : null);
    if (file) return { file, mount };
    return null;
  }
  return null;
}

export interface ServerOptions {
  port?: number; // 0 (default): any free port
  notFoundFile?: string; // HTML answered with status 404
}

export async function startStaticServer(mounts: Mount[], options: ServerOptions = {}): Promise<StaticServer> {
  const normalized = mounts.map((m) => ({ prefix: m.prefix, dir: normalize(m.dir) }));
  const server: Server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    void (async () => {
      const hit = await resolve(normalized, urlPath);
      if (!hit) {
        if (options.notFoundFile) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(await readFile(options.notFoundFile));
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const body = await readFile(hit.file);
      res.writeHead(200, {
        'content-type': TYPES[extname(hit.file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? 0, '127.0.0.1', ok);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
