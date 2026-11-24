import { DurableObject } from 'cloudflare:workers';
import puppeteer, { type Browser, type BrowserWorker } from '@cloudflare/puppeteer';
import { chromeVersionOf, createDohResolver, createFetchBudget, createUrlGuard, installPopupGuard, QUICK_CHECK_FETCHES, quickCapture, type CaptureVisit, type PopupGuardState, type UrlGuard } from '@website-check/scanner';
import { answerResponse, parseStartInput, startScan } from '../api/start.ts';
import { markError } from '../db/store.ts';
import { AXE_SOURCE } from '../capture/axe-source.ts';
import { captureWithCdpEvents } from '../capture/cdp-events.ts';
import { cloudEnvironment, sleep } from '../capture/common.ts';
import { traceBrowserVisit, traceObjectVisit, TRACE_URL } from '../capture/visit.ts';
import { QUEUE_LIMITS, ScanQueue, type KvStore, type QueueJob, type QueueLimits, type ScanMode } from './core.ts';
import { BrowserTimeExhausted, drain, type BrowserPort } from './drain.ts';
import { runScanJob, type CaptureOutcome } from './job.ts';

/**
 * The scan queue as a Durable Object (session A5 part 3; Fedor's plan after A2: the checks run in a Durable
 * Object in the EU jurisdiction, the Worker only accepts the job and passes it on). One object, reached as
 * `SCAN_QUEUE.jurisdiction('eu').idFromName('queue')`, holds the queue, the day's counters and at most one
 * browser. Its alarm runs the queue (`drain`); see `docs/decisions.md` (A5 part 3) for why. Since A5 part 5
 * it also runs the whole start of a scan (`worker/src/api/start.ts`: cache, day cap, DNS check, rate limit,
 * D1 writes); the API Worker only parses, normalizes and passes the start on (Fedor's answer (a)).
 *
 *   POST /start     {url, visitor, ratePerHour?, force?} → the API's answer to the start (status, JSON body,
 *                                                   Retry-After): 202 new and queued, 200 cached, 400, 429, 503
 *   GET  /position?id=…                           → {position}: 0 running, 1 next, null unknown
 *   GET  /stats                                   → day counters and the last jobs' measurements (the lab reads it; the
 *                                                   production Worker never routes a visitor here)
 *   GET  /limits                                  → Browser Run's limits and recent sessions (the lab reads it, as /stats)
 *
 * Since A5 part 4 the object lives in the scan Worker (`worker/src/scan-worker.ts`); it is reached only
 * through the API Worker's binding with `script_name` (a Durable Object has no public address).
 */

export interface QueueEnv {
  DB: D1Database;
  BROWSER: BrowserWorker;
  /** Key of the visitor hash of the rate limit (the start runs here since A5 part 5), a secret of the scan Worker set by Fedor (locally in `.dev.vars`). */
  RATE_LIMIT_SECRET?: string;
  /** Lab only: scans at the same time (default 3). */
  QUEUE_MAX_PARALLEL?: string;
  /** Lab only, "1": measure the cost of element positions for "Feld B2" (nothing is stored). */
  LAB_MEASURE_FIELD?: string;
  /** Local `wrangler dev` only (never set on Cloudflare): "1" with the two values below. */
  DEV_MODE?: string;
  /** Local `wrangler dev` only: exact origins of the fixture site that the SSRF guard lets through. */
  DEV_ORIGINS?: string;
  /** Local `wrangler dev` only: the trace page of the fixture site. */
  DEV_TRACE_URL?: string;
}

/** Idle timeout of a queue browser: closed by Browser Run if the object loses it (the object closes it at once when the queue is empty). */
const KEEP_ALIVE_MS = 20_000;
const METRICS_KEPT = 30;
/** Chrome of Browser Run as measured in A2 (`@cloudflare/puppeteer` 2.0.1): the quick check's user agent until a browser of the day reported its version. */
const KNOWN_CHROME_VERSION = '152.0.0.0';

export interface JobMetric {
  id: string;
  mode: ScanMode;
  outcome: string;
  state: string | null;
  error?: string;
  startedAt: number;
  wallMs: number;
  homepageMs?: number;
  impressumMs?: number;
  impressumOpened: boolean;
  events?: number;
  popupsBlocked?: number;
  fieldPositions?: { ms: number; elements: number; boxes: number; failed: boolean };
  reportBytes: number;
  findings: number;
  hosts: number;
  country: string | null;
  colo: string | null;
}

export interface BrowserMetric {
  launchedAt: number;
  launchMs: number;
  traceMs: number;
  closedAt: number | null;
  openMs: number | null;
  visit: CaptureVisit | null;
}

function kvOf(storage: DurableObjectStorage): KvStore {
  return {
    get: <T>(key: string) => storage.get<T>(key),
    put: (key, value) => storage.put(key, value),
    delete: (key) => storage.delete(key),
    list: <T>(options: { prefix: string }) => storage.list<T>(options),
  };
}

function limitsOf(env: QueueEnv): QueueLimits {
  const parallel = Number(env.QUEUE_MAX_PARALLEL ?? '');
  return Number.isInteger(parallel) && parallel >= 1 && parallel <= QUEUE_LIMITS.maxParallel ? { ...QUEUE_LIMITS, maxParallel: parallel } : QUEUE_LIMITS;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function isLimitError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate limit|limit exceeded|too many/i.test(text);
}

export class ScanQueueObject extends DurableObject<QueueEnv> {
  readonly #queue: ScanQueue;
  #browser: Browser | null = null;
  #launchedAt = 0;
  #visit: CaptureVisit | null = null;
  #objectVisit: CaptureVisit | null = null;
  #chromeVersion = KNOWN_CHROME_VERSION;
  #opening: Promise<void> | null = null;
  /** One popup guard per browser, shared by its parallel scans (one set of the scanner's own pages). */
  #popupGuard: { ownTargets: Set<string>; state: PopupGuardState } | null = null;
  #draining = false;
  /** Until when the queue refuses new scans (its day cap): further starts are answered without D1 writes. */
  readonly #dailyGate = { until: 0 };
  readonly #metrics: JobMetric[] = [];
  readonly #browsers: BrowserMetric[] = [];

  constructor(ctx: DurableObjectState, env: QueueEnv) {
    super(ctx, env);
    this.#queue = new ScanQueue(kvOf(ctx.storage), limitsOf(env));
  }

  #devMode(): boolean {
    return this.env.DEV_MODE === '1';
  }

  /** Local `wrangler dev` only: the exact fixture origins that skip the address rules. */
  #exempt(): ((url: URL) => boolean) | undefined {
    const origins = this.#devMode() ? (this.env.DEV_ORIGINS ?? '').split(',').map((o) => o.trim()).filter((o) => /^https?:\/\/[^/]+$/.test(o)) : [];
    return origins.length > 0 ? (url: URL) => origins.includes(url.origin) : undefined;
  }

  #guard(fetchFn?: typeof fetch): UrlGuard {
    const exempt = this.#exempt();
    return createUrlGuard({ resolve: createDohResolver(fetchFn), ...(exempt !== undefined ? { exempt } : {}) });
  }

  #traceUrl(): string {
    return this.#devMode() && this.env.DEV_TRACE_URL !== undefined ? this.env.DEV_TRACE_URL : TRACE_URL;
  }

  override async fetch(request: Request): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url);
    try {
      if (pathname === '/start' && request.method === 'POST') {
        const exempt = this.#exempt();
        const input = parseStartInput(await request.json().catch(() => null), exempt);
        // Not the shape the API Worker sends: our own fault, so the API answers 503, never 400 to the visitor.
        if (input === null) return json({ error: 'bad-request' }, 500);
        // One guard per start: the address is resolved once (two DNS-over-HTTPS subrequests).
        const guard = this.#guard();
        const answer = await startScan(input, {
          db: this.env.DB,
          check: (url) => guard.check(url),
          secret: this.env.RATE_LIMIT_SECRET,
          dailyGate: this.#dailyGate,
          // The stored day cap (finding 46): after an eviction the gate above is empty again.
          dayCap: (now) => this.#queue.dayCapReached(now),
          ...(exempt !== undefined ? { exempt } : {}),
          dispatch: async (scan) => {
            const result = await this.#queue.enqueue({ ...scan, ...(input.force !== undefined ? { force: input.force } : {}) }, Date.now());
            if (result.accepted) await this.#wake();
            return result;
          },
        });
        return answerResponse(answer);
      }
      if (pathname === '/position' && request.method === 'GET') {
        const id = searchParams.get('id') ?? '';
        const position = await this.#queue.position(id);
        // Self-healing when no run is active: a job waits and no alarm is set (a lost alarm), or a job counts as
        // running although nothing runs in this object (the object was restarted during a run).
        if (position !== null && !this.#draining && (position === 0 || (await this.ctx.storage.getAlarm()) === null)) await this.#wake();
        return json({ position });
      }
      if (pathname === '/stats' && request.method === 'GET') {
        const now = Date.now();
        return json({
          day: await this.#queue.day(now),
          waiting: await this.#queue.waitingCount(),
          jobs: (await this.#queue.jobs()).length,
          browserOpen: this.#browser !== null,
          draining: this.#draining,
          limits: this.#queue.limits,
          jurisdiction: this.ctx.id.jurisdiction ?? null,
          metrics: this.#metrics,
          browsers: this.#browsers,
        });
      }
      if (pathname === '/limits' && request.method === 'GET') {
        // Browser Run's limits and recent sessions, for the lab (A5 part 4: the API Worker bundles no Puppeteer).
        const [limits, history] = await Promise.all([puppeteer.limits(this.env.BROWSER).catch(() => null), puppeteer.history(this.env.BROWSER).catch(() => [])]);
        return json({ limits, history: (Array.isArray(history) ? history : []).slice(0, 10) });
      }
      return json({ error: 'not-found' }, 404);
    } catch (error) {
      return json({ error: 'failed', message: (error instanceof Error ? error.message : String(error)).slice(0, 200) }, 500);
    }
  }

  async #wake(): Promise<void> {
    if (this.#draining) return; // the running loop takes new jobs itself
    await this.ctx.storage.setAlarm(Date.now());
  }

  override async alarm(): Promise<void> {
    if (this.#draining) {
      // Not expected (alarms do not overlap), but never two runs: look again in a moment.
      await this.ctx.storage.setAlarm(Date.now() + 1_000);
      return;
    }
    this.#draining = true;
    let more = false;
    try {
      const result = await drain({
        queue: this.#queue,
        browser: this.#browserPort(),
        now: () => Date.now(),
        sleep,
        runJob: (job, mode) => this.#runJob(job, mode),
        onJobError: async (job, error) => {
          await markError(this.env.DB, job.id, `queue: ${(error instanceof Error ? error.message : String(error)).slice(0, 150)}`, Date.now());
        },
      });
      more = result.more;
    } finally {
      this.#draining = false;
      // Jobs left (the run's cap, or one that arrived at the very end): the next run starts at once.
      if (more || (await this.#queue.waitingCount()) > 0) await this.ctx.storage.setAlarm(Date.now());
    }
  }

  #browserPort(): BrowserPort {
    return {
      ensure: () => this.#ensureBrowser(),
      openMs: () => (this.#browser === null ? 0 : Date.now() - this.#launchedAt),
      closeIfOpen: () => this.#closeBrowser(),
    };
  }

  async #ensureBrowser(): Promise<void> {
    // A launch in progress first: the browser is only handed out once its trace and popup guard are ready (review).
    if (this.#opening !== null) return this.#opening;
    if (this.#browser !== null && this.#browser.connected && this.#popupGuard !== null) return;
    this.#opening = (async () => {
      if (this.#browser !== null) await this.#closeBrowser();
      // Browser Run: one new browser every 20 seconds.
      const last = await this.#queue.lastLaunchAt();
      const wait = last === null ? 0 : last + this.#queue.limits.launchSpacingMs - Date.now();
      if (wait > 0) await sleep(Math.min(wait, this.#queue.limits.launchSpacingMs));
      // Cloudflare's own count of the day's browser time (it lags a little behind; our own count is in chooseMode).
      const limits = (await puppeteer.limits(this.env.BROWSER).catch(() => null)) as { usedBrowserTimeSeconds?: number; timeUntilNextAllowedBrowserAcquisition?: number } | null;
      const usedMs = (limits?.usedBrowserTimeSeconds ?? 0) * 1000;
      if (usedMs + this.#queue.limits.reservePerScanMs > this.#queue.limits.browserBudgetMs) throw new BrowserTimeExhausted('Cloudflare counts the browser time of the day at the budget');
      if ((limits?.timeUntilNextAllowedBrowserAcquisition ?? 0) > 0) await sleep(Math.min(limits?.timeUntilNextAllowedBrowserAcquisition ?? 0, this.#queue.limits.launchSpacingMs));
      const started = Date.now();
      await this.#queue.setLastLaunchAt(started);
      let browser: Browser;
      try {
        browser = await puppeteer.launch(this.env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
      } catch (error) {
        if (!isLimitError(error)) throw error;
        // A refused launch although a new browser was allowed: the day's browser time is used up.
        const after = (await puppeteer.limits(this.env.BROWSER).catch(() => null)) as { timeUntilNextAllowedBrowserAcquisition?: number } | null;
        if ((after?.timeUntilNextAllowedBrowserAcquisition ?? 0) > 0) throw error;
        throw new BrowserTimeExhausted(error instanceof Error ? error.message.slice(0, 120) : 'launch refused');
      }
      const launchMs = Date.now() - started;
      try {
        this.#chromeVersion = chromeVersionOf(await browser.version().catch(() => KNOWN_CHROME_VERSION));
        // The trace tab loads before the popup guard exists, so the guard cannot take it for a foreign window.
        const trace = await traceBrowserVisit(browser, this.#traceUrl());
        const ownTargets = new Set<string>();
        const state = await installPopupGuard(await browser.target().createCDPSession(), ownTargets);
        // Handed out together, only when everything is ready (review of A5 part 3: a scan that started in between
        // ran with a popup guard of its own, and the two guards closed each other's tabs).
        this.#browser = browser;
        this.#launchedAt = started;
        this.#visit = trace.visit;
        this.#popupGuard = { ownTargets, state };
        this.#remember(this.#browsers, { launchedAt: started, launchMs, traceMs: trace.ms, closedAt: null, openMs: null, visit: trace.visit });
      } catch (error) {
        await browser.close().catch(() => undefined);
        await this.#queue.addBrowserTime(Date.now() - started, Date.now());
        throw error;
      }
    })().finally(() => {
      this.#opening = null;
    });
    return this.#opening;
  }

  async #closeBrowser(): Promise<void> {
    const browser = this.#browser;
    if (browser === null) return;
    this.#browser = null;
    this.#visit = null;
    this.#popupGuard = null;
    await browser.close().catch(() => undefined);
    const closedAt = Date.now();
    const openMs = closedAt - this.#launchedAt;
    await this.#queue.addBrowserTime(openMs, closedAt);
    const entry = this.#browsers.findLast((b) => b.launchedAt === this.#launchedAt);
    if (entry !== undefined) {
      entry.closedAt = closedAt;
      entry.openMs = openMs;
    }
  }

  async #capture(url: string, mode: ScanMode, metric: Partial<JobMetric>): Promise<CaptureOutcome> {
    if (mode === 'quick') {
      // Session fix-a4: one budget of requests for the whole quick check, the name lookups included.
      const fetchBudget = createFetchBudget(QUICK_CHECK_FETCHES, (input, init) => fetch(input, init));
      const guard = this.#guard(fetchBudget.fetch);
      this.#objectVisit ??= await traceObjectVisit(fetch, this.#traceUrl());
      // The same desktop Chrome user agent as the browser, as for the http redirect check since A3.
      const userAgent = cloudEnvironment(this.#chromeVersion).userAgent;
      const capture = await quickCapture(url, { guard, userAgent, visit: this.#objectVisit, fetchBudget });
      return { capture, visit: { country: this.#objectVisit.country, colo: this.#objectVisit.colo } };
    }
    const guard = this.#guard();
    const browser = this.#browser;
    // Never a full capture without the browser's shared popup guard (a guard per scan would block the other tabs).
    if (browser === null || !browser.connected || this.#popupGuard === null) throw new Error('no browser');
    const { capture, stats } = await captureWithCdpEvents(browser, url, {
      axeSource: AXE_SOURCE,
      httpProbe: true,
      guard,
      impressum: true,
      measureFieldPositions: this.env.LAB_MEASURE_FIELD === '1',
      visit: this.#visit,
      ...(this.#popupGuard !== null ? { popupGuard: this.#popupGuard } : {}),
    });
    metric.homepageMs = stats.homepageMs;
    if (stats.impressumMs !== undefined) metric.impressumMs = stats.impressumMs;
    metric.events = stats.events;
    if (stats.popupsBlocked !== undefined) metric.popupsBlocked = stats.popupsBlocked;
    if (stats.fieldPositions !== undefined) metric.fieldPositions = stats.fieldPositions;
    metric.impressumOpened = capture.impressum !== undefined && capture.impressum !== null;
    return { capture, visit: { country: this.#visit?.country ?? null, colo: this.#visit?.colo ?? null } };
  }

  async #runJob(job: QueueJob, mode: ScanMode): Promise<void> {
    const started = Date.now();
    const metric: Partial<JobMetric> = { impressumOpened: false };
    const result = await runScanJob(job, mode, { db: this.env.DB, now: () => Date.now(), capture: (url, m) => this.#capture(url, m, metric) });
    const visit = mode === 'quick' ? this.#objectVisit : this.#visit;
    this.#remember(this.#metrics, {
      ...metric,
      id: job.id,
      mode,
      outcome: result.outcome,
      state: result.state,
      ...(result.error !== undefined ? { error: result.error } : {}),
      startedAt: started,
      wallMs: Date.now() - started,
      impressumOpened: metric.impressumOpened ?? false,
      reportBytes: result.reportBytes,
      findings: result.findings,
      hosts: result.hosts,
      country: visit?.country ?? null,
      colo: visit?.colo ?? null,
    });
  }

  #remember<T>(list: T[], entry: T): void {
    list.push(entry);
    if (list.length > METRICS_KEPT) list.splice(0, list.length - METRICS_KEPT);
  }
}
