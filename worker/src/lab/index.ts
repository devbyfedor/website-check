import { DurableObject } from 'cloudflare:workers';
import puppeteer, { type Browser, type BrowserWorker, type Page } from '@cloudflare/puppeteer';
import { chromeVersionOf, createDohResolver, createUrlGuard } from '@website-check/scanner';
import { AXE_SOURCE } from '../capture/axe-source.ts';
import { captureWithCdpEvents, clientOf, prepareVisitorPage } from '../capture/cdp-events.ts';
import { cloudEnvironment, withTimeout } from '../capture/common.ts';
import { ENVIRONMENT_EXPRESSION, type EnvironmentCheck } from '../capture/emulation.ts';
import { captureWithResourceTiming } from '../capture/resource-timing.ts';
import { createLabGate, createLabRoutes, exemptOrigins, parseTrace, type LabDeps, type LabEnv, type SessionUsage, type TraceResult } from './handler.ts';

/**
 * Entry point of the lab Worker `website-check-lab` (session A2): only the measurement
 * endpoint behind a token (see `handler.ts`). Nothing is stored. Deleted after part 3 of A2.
 *
 * Since part 2 the Worker only checks the token and passes the job on to one Durable Object in
 * the EU jurisdiction (`LabBrowser`), following Cloudflare's guide "Deploy a Browser Run Worker
 * with Durable Objects": the object starts the browser, keeps it in memory between requests and
 * opens one tab per page. A Durable Object has 30 s of CPU per request instead of the Worker's
 * 10 ms, and a jurisdiction is a documented way to keep the object inside the EU.
 */

interface Env extends LabEnv {
  BROWSER: BrowserWorker;
  LAB_BROWSER: DurableObjectNamespace;
}

/** Idle timeout of the lab browser: the minimum Browser Run allows, so a crash wastes little time. */
const KEEP_ALIVE_MS = 10_000;
/** Safety net: an alarm closes a browser that got no job for this long (the guide closes after 60 s). */
const IDLE_CLOSE_MS = 30_000;
const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
/** One object for the whole lab: one browser session at a time, requests strictly one after the other. */
const OBJECT_NAME = 'lab';

/** Right after the previous request disconnected, the session can still be busy for a moment. */
async function connectWithRetry(env: Env, sessionId: string): Promise<Browser> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await puppeteer.connect(env.BROWSER, sessionId);
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * Lab requests run strictly one after the other, so a browser context that exists when a request
 * starts was left by an earlier request that the runtime terminated (for example for CPU); close it.
 */
async function closeStaleContexts(browser: Browser): Promise<number> {
  let closed = 0;
  for (const context of browser.browserContexts()) {
    if (context.id === undefined) continue;
    await context.close().then(() => (closed += 1)).catch(() => undefined);
  }
  return closed;
}

async function evaluateJson<T>(page: Page, expression: string): Promise<T> {
  const text = (await page.evaluate(`JSON.stringify(${expression})`)) as string;
  return JSON.parse(text) as T;
}

export class LabBrowser extends DurableObject<Env> {
  /** The open browser, kept in memory between requests as in Cloudflare's guide. */
  #browser: Browser | null = null;
  #lastJobAt = 0;
  readonly #routes = createLabRoutes<Env>(this.#deps());

  override async fetch(request: Request): Promise<Response> {
    this.#lastJobAt = Date.now();
    try {
      return await this.#routes(request, this.env);
    } finally {
      this.#lastJobAt = Date.now();
      if (this.#browser !== null) await this.ctx.storage.setAlarm(Date.now() + IDLE_CLOSE_MS).catch(() => undefined);
    }
  }

  /** Closes a browser that a driver left open (normally `/lab/close` closes it right after the last page). */
  override async alarm(): Promise<void> {
    if (this.#browser === null) return;
    if (Date.now() - this.#lastJobAt < IDLE_CLOSE_MS - 1_000) {
      await this.ctx.storage.setAlarm(this.#lastJobAt + IDLE_CLOSE_MS);
      return;
    }
    const browser = this.#browser;
    this.#browser = null;
    await browser.close().catch(() => undefined);
  }

  /** The kept browser if it belongs to this session and is still connected, otherwise a new connection. */
  async #browserFor(sessionId: string): Promise<{ browser: Browser; reconnected: boolean }> {
    const kept = this.#browser;
    if (kept !== null && kept.connected && kept.sessionId() === sessionId) return { browser: kept, reconnected: false };
    const browser = await connectWithRetry(this.env, sessionId);
    this.#browser = browser;
    return { browser, reconnected: true };
  }

  async #withBrowser<T extends object>(sessionId: string, work: (browser: Browser) => Promise<T>): Promise<T & { staleContextsClosed: number; reconnected: boolean }> {
    const { browser, reconnected } = await this.#browserFor(sessionId);
    const staleContextsClosed = await closeStaleContexts(browser);
    return { ...(await work(browser)), staleContextsClosed, reconnected };
  }

  #deps(): LabDeps<Env> {
    return {
      limits: async (env) => {
        const [limits, sessions] = await Promise.all([puppeteer.limits(env.BROWSER), puppeteer.sessions(env.BROWSER)]);
        return { limits, sessions: sessions.map((s) => ({ sessionId: s.sessionId, startTime: s.startTime })) };
      },

      open: async (env) => {
        if (this.#browser !== null) {
          // A browser left open by an earlier run of the driver: close it, never keep two.
          await this.#browser.close().catch(() => undefined);
          this.#browser = null;
        }
        const browser = await puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
        this.#browser = browser;
        return { sessionId: browser.sessionId(), browserVersion: await browser.version() };
      },

      trace: async (_env, sessionId, traceUrlOverride): Promise<TraceResult> => {
        const objectTrace = await fetch(traceUrlOverride ?? TRACE_URL, { signal: AbortSignal.timeout(5_000) })
          .then(async (response) => parseTrace(await response.text()))
          .catch(() => ({ loc: null, colo: null }));
        const object = { jurisdiction: this.ctx.id.jurisdiction ?? null, loc: objectTrace.loc, colo: objectTrace.colo };
        const result = await this.#withBrowser(sessionId, async (browser) => {
          const context = await browser.createBrowserContext();
          try {
            const page = await context.newPage();
            const environment = cloudEnvironment(chromeVersionOf(await browser.version()));
            // The same setup as strategy (a), so the check below shows what the sites see.
            const setupFailed = await prepareVisitorPage(page, await clientOf(page), environment.userAgent);
            await withTimeout(page.goto(traceUrlOverride ?? TRACE_URL, { waitUntil: 'load', timeout: 10_000 }), 12_000);
            const text = await evaluateJson<string>(page, 'document.body ? document.body.innerText : ""');
            const check = await evaluateJson<EnvironmentCheck>(page, ENVIRONMENT_EXPRESSION).catch(() => null);
            return { ...parseTrace(text), environment: check, setupFailed };
          } finally {
            await context.close().catch(() => undefined);
          }
        });
        return { ...result, object };
      },

      capture: (_env, sessionId, url, strategy, { devOrigins }) => {
        // One SSRF guard per page (session A5): names resolved with DNS over HTTPS; only in local
        // wrangler dev the exact fixture origins are exempt.
        const exempt = exemptOrigins(devOrigins);
        const guard = createUrlGuard({ resolve: createDohResolver(), ...(exempt !== undefined ? { exempt } : {}) });
        return this.#withBrowser(sessionId, (browser) =>
          strategy === 'cdp-events'
            ? captureWithCdpEvents(browser, url, { axeSource: AXE_SOURCE, httpProbe: true, guard, impressum: true })
            : captureWithResourceTiming(browser, url, { guard }),
        );
      },

      close: async (env, sessionId): Promise<SessionUsage | null> => {
        const { browser } = await this.#browserFor(sessionId);
        this.#browser = null;
        await browser.close();
        await this.ctx.storage.deleteAlarm().catch(() => undefined);
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
    };
  }
}

/**
 * The EU subnamespace. Local `wrangler dev` (workerd) does not implement jurisdictions, so only
 * there, recognised by the dev switch and a loopback address, the plain namespace is used.
 */
function namespaceFor(job: Request, env: Env): DurableObjectNamespace {
  const { hostname } = new URL(job.url);
  const localDev = env.LAB_ALLOW_LOCAL === '1' && (hostname === '127.0.0.1' || hostname === 'localhost');
  return localDev ? env.LAB_BROWSER : env.LAB_BROWSER.jurisdiction('eu');
}

const gate = createLabGate<Env>((job, env) => {
  const namespace = namespaceFor(job, env);
  return namespace.get(namespace.idFromName(OBJECT_NAME)).fetch(job);
});

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return gate(request, env);
  },
} satisfies ExportedHandler<Env>;
