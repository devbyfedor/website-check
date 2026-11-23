import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer';
import { handleRequest, queueStub, type Env as AppEnv } from '../app.ts';
import type { QueueEnv } from '../queue/object.ts';
import { sameToken } from './handler.ts';

/**
 * Lab Worker of the end-to-end check of session A5 part 3 (Fedor's permission in the message of A5 part 3,
 * docs/decisions.md): the real API and the real queue object (`ScanQueueObject`, EU jurisdiction) of
 * `worker/src/index.ts`, behind a token from `worker/.dev.vars`, with a lab D1 database of its own, on
 * workers.dev only. Deleted at the end of the session.
 *
 *   /api/...            the real API (token needed); `x-lab-force: quick` makes the queue run the quick check
 *   GET /lab/stats      the queue object's counters and the measurements of the last jobs (token)
 *   GET /lab/limits     Browser Run limits and recent sessions with start and end (token)
 *   GET /lab/hits       how often each fixture address was requested (token)
 *   GET /               public fixture homepage for the real Browser Run: windows opened by script, a
 *                       speculation-rules prerender, a prefetch, an image and an iframe (controls), and an
 *                       Impressum link; the queue scans it like a site
 *   GET /fixture/...    the fixture's Impressum and the hit counter (public; nothing else)
 */

interface Env extends AppEnv, QueueEnv {
  BROWSER: BrowserWorker;
  SCAN_QUEUE: DurableObjectNamespace;
  LAB_TOKEN?: string;
  /** Scans per hour per visitor in the lab (the API's default is 5). */
  LAB_RATE_PER_HOUR?: string;
}

export { ScanQueueObject } from '../queue/object.ts';

const HIT_NAMES = new Set(['popup', 'popup-noopener', 'popup-link', 'prerender-ran', 'prefetch', 'image', 'iframe']);

function html(body: string, head = ''): Response {
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Muster Werkstatt – Labor</title>${head}</head><body>${body}</body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

// The prerender target counts its document request (`prerender-document`: Chrome may fetch it ahead, like a
// prefetch) apart from what only a rendered page does (`prerender-ran`: an image and a script call). With
// prerendering off, `prerender-ran` must stay 0. The prefetch is the control that speculation rules work at all.
const HOME_HEAD = `<script type="speculationrules">{"prerender":[{"source":"list","urls":["/fixture/prerendered"],"eagerness":"immediate"}],"prefetch":[{"source":"list","urls":["/fixture/hit/prefetch"],"eagerness":"immediate"}]}</script>`;

const PRERENDERED_BODY = `<main><h1>Vorab geladen</h1><img src="/fixture/hit/prerender-ran" alt="" width="1" height="1"></main>
<script>fetch('/fixture/hit/prerender-ran');</script>`;

const HOME_BODY = `<header><h1>Muster Werkstatt (Laborseite)</h1></header>
<main><p>Eine erfundene Seite für die Prüfung des Scanners. Sie öffnet per Skript drei Fenster, die der Scanner nie laden darf.</p>
<img src="/fixture/hit/image" alt="Kontrollbild" width="1" height="1">
<iframe src="/fixture/hit/iframe" title="Kontrollrahmen" width="10" height="10"></iframe>
<a id="neu" href="/fixture/hit/popup-link" target="_blank">Neues Fenster</a></main>
<footer><a href="/fixture/impressum">Impressum</a> <a href="/fixture/datenschutz">Datenschutz</a></footer>
<script>
setTimeout(function () {
  window.open('/fixture/hit/popup');
  window.open('/fixture/hit/popup-noopener', '_blank', 'noopener');
  document.getElementById('neu').click();
}, 300);
</script>`;

const IMPRESSUM_BODY = `<main><h1>Impressum</h1><p>Angaben gemäß § 5 DDG</p>
<p>Muster Werkstatt GmbH<br>Musterweg 12<br>87654 Musterhausen</p>
<p>E-Mail: kontakt [at] muster-werkstatt.example</p>
<p>Handelsregister: HRB 12345, Amtsgericht Beispielburg</p>
<p>Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG: DE123456789</p></main>
<footer><a href="/">Start</a> <a href="/fixture/datenschutz">Datenschutz</a></footer>`;

async function recordHit(env: Env, name: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS lab_hits (name TEXT NOT NULL, at INTEGER NOT NULL)'),
    env.DB.prepare('INSERT INTO lab_hits (name, at) VALUES (?1, ?2)').bind(name, Date.now()),
  ]);
}

async function fixture(path: string, env: Env): Promise<Response> {
  if (path === '/') return html(HOME_BODY, HOME_HEAD);
  if (path === '/fixture/impressum') return html(IMPRESSUM_BODY);
  if (path === '/fixture/prerendered') {
    await recordHit(env, 'prerender-document');
    return html(PRERENDERED_BODY);
  }
  // Local wrangler dev only (DEV_TRACE_URL): a stand-in for Cloudflare's trace page.
  if (path === '/fixture/trace') return new Response('fl=dev\nloc=XX\ncolo=DEV\n', { headers: { 'content-type': 'text/plain' } });
  if (path === '/fixture/datenschutz') return html('<main><h1>Datenschutzerklärung</h1><p>Laborseite ohne Daten.</p></main>');
  const hit = /^\/fixture\/hit\/([a-z-]+)$/.exec(path)?.[1];
  if (hit !== undefined && HIT_NAMES.has(hit)) {
    await recordHit(env, hit);
    return html(`<p>${hit}</p>`);
  }
  return new Response('not found', { status: 404 });
}

function authorized(request: Request, env: Env): boolean {
  const token = env.LAB_TOKEN;
  if (token === undefined || token.length < 32) return false;
  const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  return match !== null && sameToken(match[1] ?? '', token);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/fixture/'))) return fixture(url.pathname, env);
    if (env.LAB_TOKEN === undefined || env.LAB_TOKEN.length < 32) return json({ error: 'lab_disabled' }, 503);
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
    if (url.pathname.startsWith('/api/')) {
      // The API never sees the token.
      const headers = new Headers(request.headers);
      headers.delete('authorization');
      const force = headers.get('x-lab-force') === 'quick' ? 'quick' : undefined;
      const rate = Number(env.LAB_RATE_PER_HOUR ?? '');
      const forwarded = new Request(request.url, { method: request.method, headers, ...(request.method === 'POST' ? { body: await request.arrayBuffer() } : {}) });
      return handleRequest(forwarded, env, { ...(Number.isInteger(rate) && rate > 0 ? { ratePerHour: rate } : {}), ...(force !== undefined ? { force } : {}) });
    }
    if (url.pathname === '/lab/stats') return queueStub(env.SCAN_QUEUE, request, env.DEV_MODE === '1').fetch('https://queue.internal/stats');
    if (url.pathname === '/lab/limits') {
      const [limits, history] = await Promise.all([puppeteer.limits(env.BROWSER).catch(() => null), puppeteer.history(env.BROWSER).catch(() => [])]);
      return json({ limits, history: (Array.isArray(history) ? history : []).slice(0, 10) });
    }
    if (url.pathname === '/lab/hits') {
      // Only hits since the driver's run started, so earlier runs (or a stranger on the public routes) do not count.
      const since = Number(url.searchParams.get('since') ?? '0');
      const rows = await env.DB.prepare('SELECT name, COUNT(*) AS n FROM lab_hits WHERE at >= ?1 GROUP BY name')
        .bind(Number.isFinite(since) ? since : 0)
        .all<{ name: string; n: number }>()
        .catch(() => ({ results: [] as { name: string; n: number }[] }));
      return json(Object.fromEntries(rows.results.map((r) => [r.name, r.n])));
    }
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
