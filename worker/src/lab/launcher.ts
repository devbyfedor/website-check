import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer';
import { sameToken } from './token.ts';

/**
 * Lab launcher Worker of session C2 (Fedor's permission in the session message, step 5): opens one browser at Browser
 * Run and closes it at once, without loading any page, so that a launch of the lab queue right after it meets Browser
 * Run's rule of one new browser every 20 s (a launch the queue's own mark does not know about). On workers.dev only,
 * deleted at the end of the session together with the other lab Workers.
 *
 *   POST /lab/launch   (token) → {startedAt, launchMs, closeMs, refused, before, after}: Browser Run's `limits()` before
 *                      the launch and right after the close (to see the unit of `timeUntilNextAllowedBrowserAcquisition`)
 */

interface Env {
  BROWSER: BrowserWorker;
  LAB_TOKEN?: string;
}

function authorized(request: Request, env: Env): boolean {
  const token = env.LAB_TOKEN;
  if (token === undefined || token.length < 32) return false;
  const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  return match !== null && sameToken(match[1] ?? '', token);
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200);

async function limits(env: Env): Promise<unknown> {
  return puppeteer.limits(env.BROWSER).catch((error: unknown) => ({ error: textOf(error) }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!authorized(request, env) || url.pathname !== '/lab/launch' || request.method !== 'POST') return json({ error: 'not-found' }, 404);
    const before = await limits(env);
    const startedAt = Date.now();
    let refused: string | null = null;
    let launchMs: number | null = null;
    try {
      const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 10_000 });
      launchMs = Date.now() - startedAt;
      await browser.close();
    } catch (error) {
      refused = textOf(error);
    }
    const closeMs = Date.now() - startedAt;
    const after = await limits(env);
    return json({ startedAt, launchMs, closeMs, refused, before, after });
  },
} satisfies ExportedHandler<Env>;
