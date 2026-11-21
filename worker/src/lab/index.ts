import puppeteer, { type Browser, type BrowserWorker, type CDPSession, type Page } from '@cloudflare/puppeteer';
import { chromeVersionOf } from '@website-check/scanner';
import { captureWithCdpEvents } from '../capture/cdp-events.ts';
import { cloudEnvironment, withTimeout } from '../capture/common.ts';
import { applyEmulation, ENVIRONMENT_EXPRESSION, pageEmulation, type EnvironmentCheck } from '../capture/emulation.ts';
import { captureWithResourceTiming } from '../capture/resource-timing.ts';
import { createLabHandler, parseTrace, type LabEnv, type SessionUsage, type TraceResult } from './handler.ts';

/**
 * Entry point of the lab Worker `website-check-lab` (session A2): only the measurement
 * endpoint behind a token (see `handler.ts`). Nothing is stored. Deleted after part 2 of A2.
 */

interface Env extends LabEnv {
  BROWSER: BrowserWorker;
  /** Only with LAB_ALLOW_LOCAL=1 in `.dev.vars`: a fake trace page of the local fixture site. */
  LAB_TRACE_URL?: string;
}

/** Idle timeout of the lab browser: the minimum Browser Run allows, so a crash wastes little time. */
const KEEP_ALIVE_MS = 10_000;
const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

async function withBrowser<T>(env: Env, sessionId: string, work: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await puppeteer.connect(env.BROWSER, sessionId);
  try {
    return await work(browser);
  } finally {
    await browser.disconnect().catch(() => undefined);
  }
}

async function evaluateJson<T>(page: Page, expression: string): Promise<T> {
  const text = (await page.evaluate(`JSON.stringify(${expression})`)) as string;
  return JSON.parse(text) as T;
}

async function clientOf(page: Page): Promise<CDPSession> {
  const internal = (page as unknown as { _client?: () => CDPSession })._client;
  return typeof internal === 'function' ? internal.call(page) : page.createCDPSession();
}

const handler = createLabHandler<Env>({
  async limits(env) {
    const [limits, sessions] = await Promise.all([puppeteer.limits(env.BROWSER), puppeteer.sessions(env.BROWSER)]);
    return { limits, sessions: sessions.map((s) => ({ sessionId: s.sessionId, startTime: s.startTime })) };
  },

  async open(env) {
    const browser = await puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
    const sessionId = browser.sessionId();
    const browserVersion = await browser.version();
    await browser.disconnect();
    return { sessionId, browserVersion };
  },

  async trace(env, sessionId): Promise<TraceResult> {
    return withBrowser(env, sessionId, async (browser) => {
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        const environment = cloudEnvironment(chromeVersionOf(await browser.version()));
        await applyEmulation((method, params) => clientOf(page).then((c) => c.send(method as never, params as never)), pageEmulation(environment.userAgent));
        const traceUrl = env.LAB_ALLOW_LOCAL === '1' && env.LAB_TRACE_URL !== undefined ? env.LAB_TRACE_URL : TRACE_URL;
        await withTimeout(page.goto(traceUrl, { waitUntil: 'load', timeout: 10_000 }), 12_000);
        const text = await evaluateJson<string>(page, 'document.body ? document.body.innerText : ""');
        const check = await evaluateJson<EnvironmentCheck>(page, ENVIRONMENT_EXPRESSION).catch(() => null);
        return { ...parseTrace(text), environment: check };
      } finally {
        await context.close().catch(() => undefined);
      }
    });
  },

  async capture(env, sessionId, url, strategy) {
    return withBrowser(env, sessionId, (browser) =>
      strategy === 'cdp-events' ? captureWithCdpEvents(browser, url) : captureWithResourceTiming(browser, url),
    );
  },

  async close(env, sessionId): Promise<SessionUsage | null> {
    const browser = await puppeteer.connect(env.BROWSER, sessionId);
    await browser.close();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const history: unknown = await puppeteer.history(env.BROWSER).catch(() => []);
      // Local `wrangler dev` has no history; on Cloudflare it lists recent sessions.
      const list = (Array.isArray(history) ? history : []) as { sessionId: string; startTime?: number; endTime?: number | null; closeReasonText?: string }[];
      const entry = list.find((s) => s.sessionId === sessionId);
      if (entry !== undefined && entry.endTime !== undefined && entry.endTime !== null) {
        return { sessionId, startTime: entry.startTime ?? null, endTime: entry.endTime ?? null, closeReasonText: entry.closeReasonText ?? null };
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return { sessionId, startTime: null, endTime: null, closeReasonText: null };
  },
});

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handler(request, env);
  },
} satisfies ExportedHandler<Env>;
