// A small static file server on 127.0.0.1 for the visual check: the static export of the app at `/`,
// the design reference at `/__reference/` and the self-hosted font files at `/__fonts/`.
// Development tool only; production is served by Workers Static Assets.
//
// Session B5 part 2: the app's answers (the mount `/`, and a path no mount has) carry the headers of `_headers` in its
// folder, read the way Workers Static Assets reads them (wrangler's parser and asset worker): the rules in their order,
// a path with `*` as a splat, `! Name` removes a header an earlier rule set, a header an earlier rule set is appended
// to. So every check sees the Content-Security-Policy of production; the reference and the font files get none.
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { holdBadPorts } from '@website-check/scanner/ports';

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

/** One rule of a `_headers` file: the path pattern, the headers it sets and the ones it removes. */
export interface HeaderRule {
  path: string;
  set: [string, string][];
  unset: string[];
}

/** Reads a `_headers` file: a line starting with `/` opens a rule, `Name: value` sets, `! Name` removes, `#` comments. */
export function parseHeaderRules(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('/')) {
      rules.push({ path: line, set: [], unset: [] });
      continue;
    }
    const rule = rules[rules.length - 1];
    if (rule === undefined) continue;
    const colon = line.indexOf(':');
    if (colon < 0 && line.startsWith('! ')) rule.unset.push(line.slice(2).trim());
    else if (colon > 0) rule.set.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

const escapeRegExp = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, (c) => `\\${c}`);

function pathMatches(pattern: string, path: string): boolean {
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`).test(path);
}

/** The headers the rules give a path, in the way of the asset worker of Cloudflare. */
export function headersFor(rules: readonly HeaderRule[], path: string): Headers {
  const headers = new Headers();
  const set = new Set<string>();
  for (const rule of rules) {
    if (!pathMatches(rule.path, path)) continue;
    for (const name of rule.unset) headers.delete(name);
    for (const [name, value] of rule.set) {
      if (set.has(name.toLowerCase())) headers.append(name, value);
      else {
        headers.set(name, value);
        set.add(name.toLowerCase());
      }
    }
  }
  return headers;
}

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
  /** Session B5 part 2 (npm run lighthouse): answers of a mocked API for `/api/…` (path with query), or null for a 404. */
  api?: (path: string) => { status: number; body: string } | null;
}

export async function startStaticServer(mounts: Mount[], options: ServerOptions = {}): Promise<StaticServer> {
  const normalized = mounts.map((m) => ({ prefix: m.prefix, dir: normalize(m.dir) }));
  const app = normalized.find((m) => m.prefix === '/');
  let rules: HeaderRule[] = [];
  if (app !== undefined) {
    try {
      rules = parseHeaderRules(await readFile(join(app.dir, '_headers'), 'utf8'));
    } catch {
      // no _headers: the app's answers carry no headers of their own
    }
  }
  const appHeaders = (urlPath: string): Record<string, string> => Object.fromEntries(headersFor(rules, urlPath).entries());
  const server: Server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    void (async () => {
      if (options.api !== undefined && urlPath.startsWith('/api/')) {
        const answer = options.api(urlPath) ?? { status: 404, body: '{"error":"not-found"}' };
        res.writeHead(answer.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(answer.body);
        return;
      }
      const hit = await resolve(normalized, urlPath);
      if (!hit) {
        if (options.notFoundFile) {
          res.writeHead(404, { ...appHeaders(urlPath), 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(await readFile(options.notFoundFile));
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const body = await readFile(hit.file);
      res.writeHead(200, {
        ...(hit.mount.prefix === '/' ? appHeaders(urlPath) : {}),
        'content-type': TYPES[extname(hit.file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  // Session C0 part 2: while this server lives, the operating system gives no port that Chrome refuses (ERR_UNSAFE_PORT)
  // to it or to anything else that asks for port 0 (scanner/src/local/ports.ts).
  const hold = await holdBadPorts();
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? 0, '127.0.0.1', ok);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((ok) => server.close(() => ok()));
      await hold.release();
    },
  };
}
