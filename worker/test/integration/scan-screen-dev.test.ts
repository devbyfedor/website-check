import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { startDevSite, type DevSite } from '../../../web/scripts/dev-local.ts';

/**
 * Session B2 part 2, step 4: the whole path on plain `wrangler dev` with the local Chrome (no Cloudflare account, no
 * browser minutes), on the fixture sites of `web/scripts/dev-local.ts`: the production build of the site served by
 * the API Worker, the form of the home page, the scan screen with the real API until the report, "Bericht öffnen"
 * with the id; and "Prüfung abbrechen" of a scan that waits in the queue (one scan at a time). It also counts the
 * requests of one scan screen for `docs/d1.md` and checks that the status is asked at most once a second, that the
 * status region changes only with the scan, and that no request leaves our own host.
 */

let site: DevSite;
let browser: Browser;
let host = '';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

interface Watch {
  requests: { url: string; method: string; at: number }[];
  responses: { url: string; status: number }[];
}

/** Every request of the page; the texts of the status region at each change of the DOM inside it. */
async function watched(page: Page): Promise<Watch> {
  const watch: Watch = { requests: [], responses: [] };
  page.on('request', (r) => watch.requests.push({ url: r.url(), method: r.method(), at: Date.now() }));
  page.on('response', (r) => watch.responses.push({ url: r.url(), status: r.status() }));
  // In the page (as text: the Worker's TypeScript has no DOM types).
  await page.addInitScript({
    content: `(() => {
      const seen = [];
      window.__status = seen;
      new MutationObserver((records) => {
        const region = document.querySelector('[role="status"]');
        if (region !== null && records.some((r) => region === r.target || region.contains(r.target))) seen.push(region.textContent);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    })();`,
  });
  return watch;
}

const statusTexts = (page: Page): Promise<(string | null)[]> => page.evaluate('window.__status') as Promise<(string | null)[]>;
const statusIs = (page: Page, test: string, timeout: number): Promise<unknown> =>
  page.waitForFunction(`(() => { const t = document.querySelector('[role="status"]')?.textContent ?? ''; return ${test}; })()`, null, { timeout });

async function api(path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const response = await fetch(`${site.origin}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : (JSON.parse(text) as Record<string, unknown>) };
}

async function statusOf(id: string): Promise<string> {
  return String((await api(`/api/scans/${id}`)).json?.['status']);
}

async function until(check: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out: ${what}`);
}

beforeAll(async () => {
  site = await startDevSite({ port: await freePort(), fixturePorts: [0, 0, 0], parallel: 1, build: true });
  host = new URL(site.origin).host;
  browser = await chromium.launch({ channel: 'chromium', headless: true });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await site?.stop();
});

describe('home → scan screen → ready → "Bericht öffnen" (local wrangler dev, local Chrome)', () => {
  it('the form starts the scan, the screen follows the API to the report, and the link carries the id', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const watch = await watched(page);
    await page.goto(`${site.origin}/`);
    await page.fill('#objekt', `${site.fixtures.plain.origin}/`);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/pruefung\?id=[a-z2-7]{26}$/, { timeout: 30_000 });
    const id = new URL(page.url()).searchParams.get('id') ?? '';
    expect(await page.locator('h1').textContent()).toBe('localhost wird nachgemessen');
    expect(await page.locator('a', { hasText: 'Bericht öffnen' }).count()).toBe(0);

    await statusIs(page, `t.startsWith('Die Messung ist fertig')`, 90_000);
    const link = page.locator('a', { hasText: 'Bericht öffnen' });
    expect(await link.getAttribute('href')).toBe(`/bericht?id=${id}`);
    const rows = await page.locator('ol li').allTextContents();
    expect(rows[0]).toBe('Seite aufgerufenwie von einem Besucher aus Deutschland');
    expect(rows[1]).toMatch(/^\d+ Anfragen aufgezeichnet(davon \d+ an fremde Server|keine an fremde Server)$/);
    expect(rows[4]).toBe('Impressum gefundenunter /impressum');
    expect(rows[5]).toBe('Pflichtangaben gelesenAnschrift, E-Mail, Handelsregister, USt-IdNr.');
    const summary = await page.locator('section p', { hasText: /Funde?|Keine Funde/ }).last().textContent();
    expect(summary).toMatch(/^(\d+ Funde?|Keine Funde)/);

    // The status region: a text only at real changes, ending with "fertig".
    const texts = await statusTexts(page);
    expect(texts.at(-1)).toBe('Die Messung ist fertig. Der Bericht ist bereit.');
    for (let i = 1; i < texts.length; i += 1) expect(texts[i], `status change ${i}: ${JSON.stringify(texts)}`).not.toBe(texts[i - 1]);
    for (const text of texts) expect(['', 'Die Messung läuft.', 'Die Messung ist fertig. Der Bericht ist bereit.'].includes(text ?? '') || /^Ihre Prüfung wartet/.test(text ?? '')).toBe(true);

    // Requests: none to another host; the status at most once a second.
    const others = watch.requests.filter((r) => new URL(r.url).host !== host);
    expect(others.map((r) => r.url)).toEqual([]);
    const statusCalls = watch.requests.filter((r) => r.method === 'GET' && new URL(r.url).pathname === `/api/scans/${id}`);
    for (let i = 1; i < statusCalls.length; i += 1) expect(statusCalls[i]!.at - statusCalls[i - 1]!.at).toBeGreaterThanOrEqual(1_000);
    const reportCalls = watch.requests.filter((r) => new URL(r.url).pathname === `/api/scans/${id}/report`);
    const starts = watch.requests.filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/api/scans');
    expect(starts).toHaveLength(1);
    expect(reportCalls).toHaveLength(1);
    console.log(`scan screen of one scan: ${starts.length} start, ${statusCalls.length} status requests, ${reportCalls.length} report request`);

    // The page with the id is not indexed: the meta element and the header of Workers Static Assets.
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
    const head = await fetch(`${site.origin}/pruefung?id=${id}`);
    expect(head.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    await link.click();
    await page.waitForURL(`${site.origin}/bericht?id=${id}`);
    expect(new URL(page.url()).searchParams.get('id')).toBe(id);
    await context.close();
  }, 180_000);
});

describe('"Prüfung abbrechen" of a scan that waits in the queue', () => {
  it('the waiting scan leaves the queue (its site is never visited), the running one ends with its report', async () => {
    const slow = await api('/api/scans', { url: `${site.fixtures.slow.origin}/` });
    expect(slow.status).toBe(202);
    const slowId = String(slow.json?.['id']);
    await until(async () => (await statusOf(slowId)) === 'running', 60_000, 'the slow scan runs');

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const watch = await watched(page);
    await page.goto(`${site.origin}/`);
    await page.fill('#objekt', `${site.fixtures.queued.origin}/`);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/pruefung\?id=[a-z2-7]{26}$/, { timeout: 30_000 });
    const id = new URL(page.url()).searchParams.get('id') ?? '';
    await statusIs(page, `t === 'Ihre Prüfung wartet: Platz 1 in der Warteschlange.'`, 20_000);
    expect(await statusOf(id)).toBe('queued');

    await page.click('text=Prüfung abbrechen');
    await page.waitForURL(`${site.origin}/`, { timeout: 10_000 });
    const cancel = watch.responses.find((r) => new URL(r.url).pathname === `/api/scans/${id}/cancel`);
    expect(cancel?.status).toBe(204);
    expect(await statusOf(id)).toBe('error');

    await until(async () => (await statusOf(slowId)) === 'done', 90_000, 'the slow scan ends');
    expect((await api(`/api/scans/${slowId}`)).json?.['state']).toBe('complete');
    // The browser never opened the cancelled site: not its homepage, not the http check, nothing.
    expect([...site.fixtures.queued.hits.entries()]).toEqual([]);
    await context.close();
  }, 240_000);
});
