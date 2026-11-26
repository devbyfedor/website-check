import { probeHttps } from '../../../scanner/src/security/http-probe.ts';
import { isConnectionFailure } from '../../../scanner/src/security/fetch-errors.ts';
import type { UrlGuard } from '../../../scanner/src/security/ssrf.ts';
import { heavyPage } from '../../../scanner/test/integration/heavy-pages.ts';
import { sameToken } from './token.ts';

/**
 * Lab pages Worker of session C1 (Fedor's permission in the session message): invented pages for the measurements
 * on Cloudflare, on workers.dev only, deleted at the end of the session together with the other lab Workers.
 * The scan checks only the homepage of an address, so every page is served at "/" of a host: `website-check-lab-pages`
 * and `website-check-lab-tracker` serve the page chosen with `POST /lab/mode` (kept in the lab D1, one row per Worker),
 * or the page of the variable `LAB_PAGE` while none is chosen.
 *
 *   GET  /                    the page of the mode:
 *                               small            an ordinary small page (the baseline of the HTML reader)
 *                               slow             the small page after 6 s (a scan that runs while others wait)
 *                               flood-net        the flood of our fixtures (`/heavy/flood-net` of scanner/test/integration/heavy-pages.ts)
 *                               tracker-2s       an invented page that calls a tracker 2 s after its script ran
 *                               tracker-2s-busy  the same with six small requests 400 ms apart before (no quiet network)
 *                               html-NNN         the heaviest synthetic pages of 2 MB of the HTML reader in fix-a4
 *   GET  /heavy/n             204 (the requests of the flood)
 *   GET  /impressum, /datenschutz   small pages
 *   GET  /fixture/hit/<name>  counts a request in the lab D1 (proof that the browser sent it)
 *   POST /lab/mode            {page} (token)
 *   GET  /lab/hits?since=     the counted requests since a time (token)
 *   GET  /lab/fetch-errors    the error of `fetch` for fixed addresses that refuse or do not answer (token): only our
 *                             own host and documented test addresses, never a host of anyone else
 */

interface Env {
  DB: D1Database;
  LAB_TOKEN?: string;
  /** The page of "/" while no mode is set in D1 (`website-check-lab-tracker`: the tracker page). */
  LAB_PAGE?: string;
  /** The row of this Worker in `lab_mode` (the pages and the tracker Worker share the lab D1 on Cloudflare). */
  LAB_SLOT?: string;
}

const MB2 = 2 * 1024 * 1024;
const fill = (unit: string, n = MB2): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

/**
 * The heaviest pages of the HTML reader in the measurement of fix-a4 (direct calls of `snapshotFromHtml`, 2 MB each),
 * cut to exactly 2 MiB with their first tag: the quick check reads at most 2 MiB (`SSRF_LIMITS.maxBodyBytes`) and fails a
 * larger page before the reader runs.
 */
const exactly = (head: string, unit: string): string => head + fill(unit, MB2 - head.length);
const HEAVY_HTML: Record<string, () => string> = {
  'html-028': () => exactly('<table><tr>', '<td>c'), // td x many columns: 1,329 and 1,298 ms on the laptop
  'html-060': () => fill('<hr>'), // hr x many: 1,140 ms
  'html-059': () => fill('<p>'), // p x many empty: 1,078 and 1,110 ms
  'html-020': () => exactly('<dl>', '<dd><span><dt><span>'), // dd dt alternating: 1,125 ms
  'html-024': () => exactly('<table>', 'x<b>y'), // table foster parenting text: 969 ms
  'html-025': () => fill('<table><tr><td><table>'), // table tr td misnested tables: 953 ms
};

const SMALL_BODY = `<header><h1>Muster Werkstatt (Laborseite)</h1></header>
<main><p>Eine erfundene Seite für die Messungen des Scanners.</p></main>
<footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></footer>`;

// The tracker: an image of a host under the reserved name ".example" (RFC 2606, never resolves: no host of anyone is
// asked) and, at the same moment, a counted request to this Worker, which shows that the browser really sent it.
const TRACKER_SCRIPT = `setTimeout(function () {
  new Image().src = 'https://tracker.example/collect?t=2s';
  fetch('/fixture/hit/tracker-2s', { cache: 'no-store' }).catch(function () {});
}, 2000);`;
const TRACKER_BODY = `${SMALL_BODY}
<script>
${TRACKER_SCRIPT}
</script>`;
// The same page with a network that is not quiet for 1.5 s before the tracker: six small requests 400 ms apart, as the
// ordinary page of the integration test (`/heavy/plain`), so a capture alone still runs when the tracker comes.
const TRACKER_BUSY_BODY = `${SMALL_BODY}
<script>
var n = 0; var t = setInterval(function () { fetch('/heavy/n?' + (n++), { cache: 'no-store' }).catch(function () {}); if (n > 5) clearInterval(t); }, 400);
${TRACKER_SCRIPT}
</script>`;

const IMPRESSUM_BODY = `<main><h1>Impressum</h1><p>Angaben gemäß § 5 DDG</p>
<p>Muster Werkstatt GmbH<br>Musterweg 12<br>87654 Musterhausen</p>
<p>E-Mail: kontakt [at] muster-werkstatt.example</p></main>
<footer><a href="/">Start</a> <a href="/datenschutz">Datenschutz</a></footer>`;

const HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

function page(body: string, title = 'Muster Werkstatt – Labor'): Response {
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`, { headers: HEADERS });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

const slotOf = (env: Env): string => env.LAB_SLOT ?? 'pages';

async function modeOf(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT page FROM lab_mode WHERE slot = ?1').bind(slotOf(env)).first<{ page: string }>().catch(() => null);
  return row?.page ?? env.LAB_PAGE ?? 'small';
}

async function home(env: Env): Promise<Response> {
  const mode = await modeOf(env);
  if (mode === 'small') return page(SMALL_BODY);
  if (mode === 'slow') {
    await new Promise((done) => setTimeout(done, 6_000));
    return page(SMALL_BODY);
  }
  if (mode === 'tracker-2s') return page(TRACKER_BODY);
  if (mode === 'tracker-2s-busy') return page(TRACKER_BUSY_BODY);
  if (mode === 'flood-net') {
    const answer = heavyPage('/heavy/flood-net');
    if (answer === null) return new Response('no flood', { status: 500 });
    return new Response(answer.body, { status: answer.status, headers: { ...HEADERS, 'content-type': answer.type } });
  }
  const heavy = HEAVY_HTML[mode];
  if (heavy !== undefined) return new Response(heavy(), { headers: HEADERS });
  return new Response('unknown mode', { status: 500 });
}

async function recordHit(env: Env, name: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS lab_hits (name TEXT NOT NULL, at INTEGER NOT NULL)'),
    env.DB.prepare('INSERT INTO lab_hits (name, at) VALUES (?1, ?2)').bind(name, Date.now()),
  ]);
}

function authorized(request: Request, env: Env): boolean {
  const token = env.LAB_TOKEN;
  if (token === undefined || token.length < 32) return false;
  const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  return match !== null && sameToken(match[1] ?? '', token);
}

/** The guard of the product, replaced for this list only: every address here is fixed in the code. */
const ALLOW_FIXED: UrlGuard = { check: async (url) => ({ allowed: true, url: String(url), addresses: [], exempt: true }) };

function errorChain(error: unknown): { name: string; message: string; code: string | null }[] {
  const chain: { name: string; message: string; code: string | null }[] = [];
  for (let current: unknown = error, depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      chain.push({ name: current.name, message: current.message.slice(0, 300), code: typeof code === 'string' || typeof code === 'number' ? String(code) : null });
      current = (current as { cause?: unknown }).cause;
    } else {
      chain.push({ name: typeof current, message: String(current).slice(0, 300), code: null });
      break;
    }
  }
  return chain;
}

/**
 * Session C1: the error text of `fetch` in a Worker when a connection is refused (backlog, reviews of fix-a2 and fix-a5).
 * Only our own host (a port nothing listens on) and documented addresses: loopback, the test networks of RFC 5737 and
 * RFC 3849, the reserved name ".invalid" of RFC 2606. Each address once with the raw `fetch` (its error as thrown) and
 * once through the product's `probeHttps` (the outcome the report would get) and `isConnectionFailure`.
 */
async function fetchErrors(request: Request): Promise<Response> {
  const own = new URL(request.url).hostname;
  const targets = [
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://192.0.2.1/',
    'https://[2001:db8::1]/',
    `https://${own}:444/`,
    'https://refused.invalid/',
  ];
  const timeoutMs = 8_000;
  const results = await Promise.all(
    targets.map(async (target) => {
      const started = Date.now();
      let raw: Record<string, unknown>;
      try {
        const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        const text = (await response.text().catch(() => '')).slice(0, 200);
        raw = { kind: 'response', status: response.status, server: response.headers.get('server'), cfRay: response.headers.get('cf-ray') !== null, body: text, ms: Date.now() - started };
      } catch (error) {
        const chain = errorChain(error);
        const joined = chain.map((c) => `${c.name}: ${c.message}${c.code === null ? '' : ` (${c.code})`}`).join(' <- ');
        raw = { kind: 'error', chain, isConnectionFailure: isConnectionFailure(joined), ms: Date.now() - started };
      }
      const probe = target.startsWith('https:') ? await probeHttps(target, { guard: ALLOW_FIXED, timeoutMs }) : null;
      return { target: target === `https://${own}:444/` ? 'https://<own lab host>:444/' : target, raw, probe: probe === null ? null : { outcome: probe.outcome, status: probe.status, error: probe.error, isConnectionFailure: probe.error === null ? null : isConnectionFailure(probe.error), ms: probe.durationMs } };
    }),
  );
  return json({ results });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/') return home(env);
  if (request.method === 'GET' && url.pathname === '/heavy/n') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (request.method === 'GET' && url.pathname === '/impressum') return page(IMPRESSUM_BODY, 'Impressum');
  if (request.method === 'GET' && url.pathname === '/datenschutz') return page('<main><h1>Datenschutzerklärung</h1><p>Laborseite ohne Daten.</p></main>', 'Datenschutz');
  const hit = /^\/fixture\/hit\/([a-z0-9-]{1,40})$/.exec(url.pathname)?.[1];
  if (request.method === 'GET' && hit !== undefined) {
    await recordHit(env, hit);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }
  if (!url.pathname.startsWith('/lab/')) return new Response('not found', { status: 404 });
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
  if (url.pathname === '/lab/mode' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { page?: unknown } | null;
    const pageName = typeof body?.page === 'string' ? body.page : '';
    if (!['small', 'slow', 'tracker-2s', 'tracker-2s-busy', 'flood-net', ...Object.keys(HEAVY_HTML)].includes(pageName)) return json({ error: 'unknown page' }, 400);
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS lab_mode (slot TEXT PRIMARY KEY, page TEXT NOT NULL)'),
      env.DB.prepare('INSERT INTO lab_mode (slot, page) VALUES (?1, ?2) ON CONFLICT (slot) DO UPDATE SET page = excluded.page').bind(slotOf(env), pageName),
    ]);
    return json({ page: pageName });
  }
  if (url.pathname === '/lab/hits' && request.method === 'GET') {
    const since = Number(url.searchParams.get('since') ?? '0');
    const rows = await env.DB.prepare('SELECT name, COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last FROM lab_hits WHERE at >= ?1 GROUP BY name')
      .bind(Number.isFinite(since) ? since : 0)
      .all<{ name: string; n: number; first: number; last: number }>()
      .catch(() => ({ results: [] as { name: string; n: number; first: number; last: number }[] }));
    return json(rows.results);
  }
  if (url.pathname === '/lab/fetch-errors' && request.method === 'GET') return fetchErrors(request);
  return json({ error: 'not_found' }, 404);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => route(request, env),
} satisfies ExportedHandler<Env>;
