import { DurableObject } from 'cloudflare:workers';
import puppeteer, { type Browser, type BrowserWorker } from '@cloudflare/puppeteer';
import { chromeVersionOf, createDohResolver, createFetchBudget, createUrlGuard, installPopupGuard, QUICK_CHECK_FETCHES, quickCapture, type CaptureVisit, type PopupGuardState, type UrlGuard } from '@website-check/scanner';
import { isCancelToken, isScanId, newCancelToken } from '../api/ids.ts';
import { answerResponse, parseStartInput, startScan } from '../api/start.ts';
import { markError } from '../db/store.ts';
import { AXE_SOURCE } from '../capture/axe-source.ts';
import { captureWithCdpEvents } from '../capture/cdp-events.ts';
import { cloudEnvironment, sleep } from '../capture/common.ts';
import { traceBrowserVisit, traceObjectVisit, TRACE_URL } from '../capture/visit.ts';
import { QUEUE_LIMITS, ScanQueue, type KvStore, type QueueJob, type QueueLimits, type ScanMode } from './core.ts';
import { BrowserTimeExhausted, drain, type BrowserPort } from './drain.ts';
import { runScanJob, type CaptureOutcome } from './job.ts';
import { BrowserLaunchRefused, launchBrowser, type BrowserRunReading, type Launch } from './launch.ts';

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
 *   POST /cancel    {id, token}                   → {outcome}: "Prüfung abbrechen" of one visitor (session B2 part 2;
 *                                                   `CancelOutcome` in core.ts); the API Worker answers 204 whatever it is
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
/** When D1 did not take a scan's error, the next try comes this much later (session fix-a5, review finding 44). */
const UNRECORDED_RETRY_MS = 60_000;
/** The D1 write of a cancel holds the queue's order of changes at most this long (review of B2 part 2). */
const CANCEL_WRITE_MS = 5_000;
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
  /** Session C2: refused attempts before this browser (their text from Browser Run), and the time waited for its launch. */
  refusals: string[];
  waitedMs: number;
}

/** Session C2: a launch that gave no browser (the day used up by Browser Run's word, refused twice, another error). */
export interface LaunchFailure {
  at: number;
  kind: 'day-used-up' | 'refused-twice' | 'error';
  refusals: string[];
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
  readonly #launchFailures: LaunchFailure[] = [];

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
            // Session B2 part 2: the visitor's cancel token is kept with the job.
            const holder = newCancelToken();
            const result = await this.#queue.enqueue({ ...scan, holder, ...(input.force !== undefined ? { force: input.force } : {}) }, Date.now());
            if (!result.accepted) return result;
            await this.#wake();
            return { ...result, token: holder };
          },
          join: async (id) => {
            const token = newCancelToken();
            return (await this.#queue.join(id, token)) ? token : null;
          },
        });
        return answerResponse(answer);
      }
      if (pathname === '/cancel' && request.method === 'POST') {
        // Session B2 part 2 (Fedor's answer 2): "Prüfung abbrechen". The API Worker checked the form of id and token.
        const body = (await request.json().catch(() => null)) as { id?: unknown; token?: unknown } | null;
        const id = typeof body?.id === 'string' && isScanId(body.id) ? body.id : null;
        const token = typeof body?.token === 'string' && isCancelToken(body.token) ? body.token : null;
        if (id === null || token === null) return json({ error: 'bad-request' }, 500);
        const outcome = await this.#queue.cancel(id, token, (job) => this.#recordCancel(job.id));
        return json({ outcome });
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
          launchFailures: this.#launchFailures,
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

  /**
   * A cancelled scan ends in D1 as an error with the reason `cancelled` (no report; the cache never reuses it). When
   * D1 does not take it, the next runs write it, as for every scan whose end D1 did not take (session fix-a5).
   */
  async #recordCancel(id: string): Promise<void> {
    try {
      // The queue waits for this write (its order of changes): at most a few seconds, then the next runs write it.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('D1 slow')), CANCEL_WRITE_MS);
      });
      try {
        await Promise.race([markError(this.env.DB, id, 'cancelled', Date.now()), slow]);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      await this.#queue.addUnrecorded(id, 'cancelled', Date.now());
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + UNRECORDED_RETRY_MS);
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
    let unrecorded = 0;
    try {
      unrecorded = await this.#recordPendingErrors();
      const result = await drain({
        queue: this.#queue,
        browser: this.#browserPort(),
        now: () => Date.now(),
        sleep,
        runJob: (job, mode) => this.#runJob(job, mode),
        onJobError: async (job, error) => {
          await markError(this.env.DB, job.id, `queue: ${(error instanceof Error ? error.message : String(error)).slice(0, 150)}`, Date.now());
        },
        onCancelledLeft: (job) => this.#recordCancel(job.id),
      });
      more = result.more;
    } finally {
      this.#draining = false;
      // Jobs left (the run's cap, or one that arrived at the very end): the next run starts at once.
      if (more || (await this.#queue.waitingCount()) > 0) await this.ctx.storage.setAlarm(Date.now());
      // Errors D1 did not take: another try in a minute, not only with the next scan (finding 44).
      else if (unrecorded > 0 || (await this.#queue.unrecorded(Date.now())).length > 0) await this.ctx.storage.setAlarm(Date.now() + UNRECORDED_RETRY_MS);
    }
  }

  /** Writes the errors of scans that D1 did not take before; returns how many are still not written. */
  async #recordPendingErrors(): Promise<number> {
    let left = 0;
    for (const entry of await this.#queue.unrecorded(Date.now())) {
      try {
        await markError(this.env.DB, entry.id, entry.reason, Date.now());
        await this.#queue.clearUnrecorded(entry.id);
      } catch {
        left += 1;
      }
    }
    return left;
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
      // Session C2: the 20 s between new browsers from the start of the last session, one more attempt after a
      // refusal, and the day's end only from Browser Run's answer or its own count (`launch.ts`).
      let launch: Launch;
      try {
        launch = await launchBrowser({
          // `puppeteer.launch` is acquire and connect in one; apart, a session that was acquired but could not be
          // connected is not lost (session fix-a5, review finding 50).
          acquire: async () => (await puppeteer.acquire(this.env.BROWSER, { keep_alive: KEEP_ALIVE_MS })).sessionId,
          // Cloudflare's own count of the day's browser time (it lags a little behind; our own count is in chooseMode).
          readLimits: async () => ((await puppeteer.limits(this.env.BROWSER).catch(() => null)) as BrowserRunReading | null) ?? null,
          lastLaunchAt: () => this.#queue.lastLaunchAt(),
          setLastLaunchAt: (at) => this.#queue.setLastLaunchAt(at),
          now: () => Date.now(),
          sleep,
          limits: this.#queue.limits,
        });
      } catch (error) {
        this.#remember(this.#launchFailures, {
          at: Date.now(),
          kind: error instanceof BrowserTimeExhausted ? 'day-used-up' : error instanceof BrowserLaunchRefused ? 'refused-twice' : 'error',
          refusals: error instanceof BrowserLaunchRefused ? error.refusals : [(error instanceof Error ? error.message : String(error)).slice(0, 200)],
        });
        throw error;
      }
      const started = launch.startedAt;
      const sessionId = launch.sessionId;
      let browser: Browser;
      try {
        browser = await puppeteer.connect(this.env.BROWSER, sessionId);
      } catch {
        // The session runs at Browser Run from the acquire on. One more try a moment later ("retry", says the error);
        // with a handle it is closed like any browser of the queue.
        await sleep(1_000);
        try {
          browser = await puppeteer.connect(this.env.BROWSER, sessionId);
        } catch (error) {
          // Without a handle the session cannot be closed: Browser Run ends it after the keep-alive without a
          // connection. That time counts against the day like the time of any browser of the queue.
          await this.#queue.addBrowserTime(Date.now() - started + KEEP_ALIVE_MS, Date.now());
          throw error;
        }
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
        this.#remember(this.#browsers, { launchedAt: started, launchMs, traceMs: trace.ms, closedAt: null, openMs: null, visit: trace.visit, refusals: launch.refusals, waitedMs: launch.waitedMs });
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
    // Read before the first await (session fix-a5, review finding 49): while this browser closes, another job of
    // the run may open a new one and set `#launchedAt` again.
    const launchedAt = this.#launchedAt;
    this.#browser = null;
    this.#visit = null;
    this.#popupGuard = null;
    await browser.close().catch(() => undefined);
    const closedAt = Date.now();
    const openMs = closedAt - launchedAt;
    await this.#queue.addBrowserTime(openMs, closedAt);
    const entry = this.#browsers.findLast((b) => b.launchedAt === launchedAt);
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
    const result = await runScanJob(job, mode, { db: this.env.DB, now: () => Date.now(), sleep, capture: (url, m) => this.#capture(url, m, metric) });
    if (result.unrecorded === true) await this.#queue.addUnrecorded(job.id, result.error ?? 'save-failed', Date.now());
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
