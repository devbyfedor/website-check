import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capture } from '@website-check/scanner';
import { shopCapture } from '../../scanner/test/report-helpers.ts';
import { MemoryKv, utcDayOf } from '../src/queue/core.ts';
import { D1_TEST_TIMEOUT_MS, countingD1, localD1, TABLES, type LocalD1 } from './d1.ts';

// Tests against the local D1 measure no time; the timeout only stops one whose local D1 never answers (test/d1.ts).
vi.setConfig({ testTimeout: D1_TEST_TIMEOUT_MS, hookTimeout: D1_TEST_TIMEOUT_MS });

/**
 * The production queue object `ScanQueueObject` itself (session fix-a5, review finding 31: no test ran
 * `worker/src/queue/object.ts`), with the findings of the session about its browser (47, 49, 50) and its day cap
 * (46). `cloudflare:workers` is a stub (worker/vitest.config.ts); Browser Run, the capture in the browser and the
 * trace page are fakes; the start, the queue, the drain, the report and D1 (the local one) are the real code.
 */

const fake = vi.hoisted(() => {
  interface FakeBrowser {
    id: number;
    connected: boolean;
    closed: boolean;
    version(): Promise<string>;
    target(): { createCDPSession(): Promise<object> };
    close(): Promise<void>;
  }
  const state = {
    acquired: 0,
    connects: 0,
    /** Connections that fail before one succeeds (finding 50). */
    connectFailures: 0,
    browsers: [] as FakeBrowser[],
    /** Called at the start of a browser's close; the close ends when the returned promise does (finding 49). */
    onClose: null as null | ((browser: FakeBrowser) => Promise<void>),
    /** Whether a browser was open while each quick check ran (finding 47). */
    openAtQuick: [] as boolean[],
    capture: null as null | (() => Capture),
    /** Session B2 part 2: a capture waits for this before it ends (a scan that is running while a visitor cancels). */
    captureGate: null as null | Promise<void>,
    log: [] as string[],
  };
  const newBrowser = (): FakeBrowser => {
    const browser: FakeBrowser = {
      id: state.browsers.length + 1,
      connected: true,
      closed: false,
      version: async () => 'HeadlessChrome/152.0.0.0',
      target: () => ({ createCDPSession: async () => ({}) }),
      close: async () => {
        state.log.push(`close ${browser.id}`);
        if (state.onClose !== null) await state.onClose(browser);
        browser.connected = false;
        browser.closed = true;
      },
    };
    state.browsers.push(browser);
    return browser;
  };
  const puppeteer = {
    limits: async () => ({ usedBrowserTimeSeconds: 0, timeUntilNextAllowedBrowserAcquisition: 0 }),
    history: async () => [],
    acquire: async () => {
      state.acquired += 1;
      state.log.push(`acquire ${state.acquired}`);
      return { sessionId: `session-${state.acquired}` };
    },
    connect: async () => {
      state.connects += 1;
      if (state.connectFailures > 0) {
        state.connectFailures -= 1;
        throw new Error('Unable to connect to existing session (it may still be in use or not ready yet) - retry or launch a new browser');
      }
      const browser = newBrowser();
      state.log.push(`connect ${browser.id}`);
      return browser;
    },
    // What @cloudflare/puppeteer 2.0.1 does: acquire, then connect (used by the object before fix-a5).
    launch: async (endpoint: unknown, options: unknown) => {
      const { sessionId } = await puppeteer.acquire();
      void endpoint;
      void options;
      void sessionId;
      return puppeteer.connect();
    },
  };
  return { state, puppeteer };
});

vi.mock('@cloudflare/puppeteer', () => ({ default: fake.puppeteer }));
vi.mock('../src/capture/axe-source.ts', () => ({ AXE_SOURCE: '' }));
vi.mock('../src/capture/visit.ts', () => ({
  TRACE_URL: 'https://trace.invalid/',
  traceBrowserVisit: async () => ({ visit: { country: 'AT', colo: 'VIE', source: 'browser-trace' }, ms: 1 }),
  traceObjectVisit: async () => ({ country: 'AT', colo: 'VIE', source: 'object-trace' }),
}));
vi.mock('../src/capture/cdp-events.ts', () => ({
  captureWithCdpEvents: async (browser: { closed: boolean }) => {
    if (browser.closed) throw new Error('browser closed under the capture');
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (fake.state.captureGate !== null) await fake.state.captureGate;
    return { capture: fake.state.capture?.() ?? shopCapture(), stats: { homepageMs: 5, events: 1 } };
  },
}));
vi.mock('../src/capture/common.ts', async (original) => ({
  ...(await original<typeof import('../src/capture/common.ts')>()),
  // Launch spacing and polling in milliseconds instead of seconds.
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5))),
}));
vi.mock('@website-check/scanner', async (original) => ({
  ...(await original<typeof import('@website-check/scanner')>()),
  createDohResolver: () => async () => ['93.184.215.14'],
  installPopupGuard: async () => ({ blocked: [] }),
  quickCapture: async (url: string) => {
    fake.state.openAtQuick.push(fake.state.browsers.some((b) => !b.closed));
    return { ...shopCapture(), requestedUrl: url, axe: null, adapter: 'quick-fetch' } as Capture;
  },
}));

const { ScanQueueObject } = await import('../src/queue/object.ts');

const SECRET = 'test-secret-of-the-unit-tests-only-0123456789';

class FakeStorage extends MemoryKv {
  alarm: number | null = null;
  async setAlarm(at: number): Promise<void> {
    this.alarm = at;
  }
  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }
}

let d1: LocalD1;

function objectWith(storage: FakeStorage, env: Record<string, unknown> = {}, db: D1Database = d1.db) {
  const ctx = { storage, id: { jurisdiction: 'eu' } } as unknown as DurableObjectState;
  return new ScanQueueObject(ctx, { DB: db, BROWSER: {} as never, RATE_LIMIT_SECRET: SECRET, ...env });
}

async function start(object: InstanceType<typeof ScanQueueObject>, url: string, extra: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await object.fetch(new Request('https://queue/start', { method: 'POST', body: JSON.stringify({ url, visitor: '4:3405803853', ...extra }) }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function stats(object: InstanceType<typeof ScanQueueObject>): Promise<{ browserOpen: boolean; day: { full: number; quick: number; browserMs: number }; browsers: { closedAt: number | null; openMs: number | null; launchedAt: number }[] }> {
  return (await (await object.fetch(new Request('https://queue/stats'))).json()) as never;
}

async function scanRow(id: unknown): Promise<{ status: string; state: string | null; error: string | null; mode: string | null }> {
  return (await d1.db.prepare('SELECT status, state, error, mode FROM scans WHERE id = ?1').bind(id).all<{ status: string; state: string | null; error: string | null; mode: string | null }>()).results[0]!;
}

beforeAll(async () => {
  d1 = await localD1();
}, 60_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  await d1.clear();
  Object.assign(fake.state, { acquired: 0, connects: 0, connectFailures: 0, browsers: [], onClose: null, openAtQuick: [], capture: null, captureGate: null, log: [] });
});

describe('finding 31: the production queue object runs a scan from the start to the closed browser', () => {
  it('start, full check with the browser, report in D1, browser closed and its time counted', async () => {
    const object = objectWith(new FakeStorage());
    const started = await start(object, 'https://kaffee-beispiel.de/');
    expect(started.status).toBe(202);
    expect(started.body.queuePosition).toBe(1);
    await object.alarm();
    expect(await scanRow(started.body.id)).toEqual({ status: 'done', state: 'complete', error: null, mode: 'full' });
    expect(fake.state.log).toEqual(['acquire 1', 'connect 1', 'close 1']);
    const after = await stats(object);
    expect(after.browserOpen).toBe(false);
    expect(after.day.full).toBe(1);
    expect(after.browsers).toHaveLength(1);
    expect(after.browsers[0]?.closedAt).not.toBeNull();
    expect(after.day.browserMs).toBe(after.browsers[0]?.openMs);
  });

  it('finding 46 through the object: at the stored day cap a start writes nothing in D1, also in a fresh instance', async () => {
    const storage = new FakeStorage();
    const now = Date.now();
    await storage.put('day', { day: utcDayOf(now), accepted: 150, full: 80, quick: 70, browserMs: 0, exhausted: false });
    const counting = countingD1(d1.db);
    for (let instance = 0; instance < 3; instance += 1) {
      const refused = await start(objectWith(storage, {}, counting.db), `https://laden-${instance}-beispiel.de/`);
      expect(refused.status).toBe(503);
      expect(refused.body.error).toBe('daily-limit');
    }
    expect(counting.written()).toBe(0);
    for (const table of TABLES) expect((await d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).all<{ n: number }>()).results[0]?.n, table).toBe(0);
  });
});

describe('finding 47: the browser closes as soon as only quick checks are left', () => {
  it('a full check, then two quick checks: the browser is closed before the first quick check runs', async () => {
    const object = objectWith(new FakeStorage(), { QUEUE_MAX_PARALLEL: '1' });
    const full = await start(object, 'https://voll-beispiel.de/');
    const quick1 = await start(object, 'https://schnell-1-beispiel.de/', { force: 'quick' });
    const quick2 = await start(object, 'https://schnell-2-beispiel.de/', { force: 'quick' });
    for (let run = 0; run < 3 && (await d1.db.prepare("SELECT COUNT(*) AS n FROM scans WHERE status IN ('queued', 'running')").all<{ n: number }>()).results[0]?.n; run += 1) await object.alarm();
    expect((await scanRow(full.body.id)).mode).toBe('full');
    expect([(await scanRow(quick1.body.id)).mode, (await scanRow(quick2.body.id)).mode]).toEqual(['quick', 'quick']);
    expect(fake.state.openAtQuick).toEqual([false, false]);
    expect(fake.state.log).toEqual(['acquire 1', 'connect 1', 'close 1']);
  });

  it('control: a full check waiting behind the first keeps the browser open (one launch for both)', async () => {
    const object = objectWith(new FakeStorage(), { QUEUE_MAX_PARALLEL: '1' });
    await start(object, 'https://voll-1-beispiel.de/');
    await start(object, 'https://voll-2-beispiel.de/');
    await object.alarm();
    expect(fake.state.log).toEqual(['acquire 1', 'connect 1', 'close 1']);
  });
});

describe('finding 49: the time of a closed browser is counted from its own launch', () => {
  it('a new browser opened while the old one closes does not take over the old one\'s time', async () => {
    const object = objectWith(new FakeStorage());
    let opened!: () => void;
    const secondOpen = new Promise<void>((resolve) => (opened = resolve));
    fake.state.onClose = async (browser) => {
      if (browser.id !== 1) return;
      // While browser 1 closes, a new full check arrives and the same run opens browser 2.
      expect((await start(object, 'https://zweite-beispiel.de/')).status).toBe(202);
      const wait = setInterval(() => {
        if (fake.state.browsers.length >= 2) opened();
      }, 1);
      await secondOpen;
      clearInterval(wait);
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    await start(object, 'https://erste-beispiel.de/');
    await object.alarm();
    const after = await stats(object);
    expect(fake.state.log.filter((l) => !l.startsWith('acquire'))).toEqual(['connect 1', 'close 1', 'connect 2', 'close 2']);
    expect(after.browsers).toHaveLength(2);
    const [first, second] = after.browsers;
    // Browser 1 was open until its slow close ended, after browser 2 had launched.
    expect(first?.closedAt).not.toBeNull();
    expect(first!.closedAt!).toBeGreaterThan(second!.launchedAt);
    expect(first!.openMs!).toBe(first!.closedAt! - first!.launchedAt);
    expect(second!.openMs!).toBe(second!.closedAt! - second!.launchedAt);
    expect(after.day.browserMs).toBe(first!.openMs! + second!.openMs!);
  });
});

describe('finding 44: when D1 takes neither the report nor the error, the queue writes the error with its next alarm', () => {
  it('the scan does not stay running until the hourly cron: one minute later it is our error', async () => {
    const storage = new FakeStorage();
    let failing = false;
    const db = new Proxy(d1.db, {
      get(target, prop) {
        if (failing && (prop === 'prepare' || prop === 'batch')) {
          return () => {
            throw new Error('Too many subrequests.');
          };
        }
        const value: unknown = Reflect.get(target, prop);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    fake.state.capture = () => {
      failing = true;
      return shopCapture();
    };
    const object = objectWith(storage, {}, db);
    const started = await start(object, 'https://kaffee-beispiel.de/');
    await object.alarm();
    expect((await scanRow(started.body.id)).status).toBe('running');
    // The next try is set a minute ahead, not only for the next scan.
    expect(storage.alarm).not.toBeNull();
    expect(storage.alarm! - Date.now()).toBeGreaterThan(30_000);
    failing = false;
    await object.alarm();
    const row = await scanRow(started.body.id);
    expect(row.status).toBe('error');
    expect(row.error).toMatch(/^save-failed: /);
  });
});

describe('finding 50: a session acquired without a connection is retried, or closed by Browser Run and counted', () => {
  it('the connection fails once: one more try, the scan runs, the browser is closed', async () => {
    fake.state.connectFailures = 1;
    const object = objectWith(new FakeStorage());
    const started = await start(object, 'https://kaffee-beispiel.de/');
    await object.alarm();
    expect(await scanRow(started.body.id)).toMatchObject({ status: 'done', state: 'complete' });
    expect([fake.state.acquired, fake.state.connects]).toEqual([1, 2]);
    expect(fake.state.log).toEqual(['acquire 1', 'connect 1', 'close 1']);
  });

  it('the connection fails twice: the scan is our error, and the session counts with its keep-alive of 20 s', async () => {
    fake.state.connectFailures = 2;
    const object = objectWith(new FakeStorage());
    const started = await start(object, 'https://kaffee-beispiel.de/');
    await object.alarm();
    const row = await scanRow(started.body.id);
    expect(row.status).toBe('error');
    expect(row.error).toMatch(/^queue: /);
    expect(fake.state.acquired).toBe(1);
    const after = await stats(object);
    expect(after.browserOpen).toBe(false);
    expect(after.day.browserMs).toBeGreaterThanOrEqual(20_000);
  });
});

describe('session B2 part 2: "Prüfung abbrechen" through the production queue object', () => {
  async function cancel(object: InstanceType<typeof ScanQueueObject>, id: unknown, token: unknown): Promise<string> {
    const response = await object.fetch(new Request('https://queue/cancel', { method: 'POST', body: JSON.stringify({ id, token }) }));
    return ((await response.json()) as { outcome: string }).outcome;
  }
  const waitFor = async (check: () => Promise<boolean>): Promise<void> => {
    for (let i = 0; i < 400 && !(await check()); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  };

  it('a scan cancelled in the queue never starts a browser, ends in D1 as cancelled, and is never reused', async () => {
    const object = objectWith(new FakeStorage());
    const started = await start(object, 'https://kaffee-beispiel.de/');
    expect(started.status).toBe(202);
    expect(started.body.cancelToken).toMatch(/^[a-z2-7]{26}$/);
    expect(started.body.displayHost).toBe('kaffee-beispiel.de');
    expect(await cancel(object, started.body.id, started.body.cancelToken)).toBe('removed');
    expect(await scanRow(started.body.id)).toEqual({ status: 'error', state: null, error: 'cancelled', mode: null });
    await object.alarm();
    expect(fake.state.acquired).toBe(0);
    expect(fake.state.log).toEqual([]);
    const again = await start(object, 'https://kaffee-beispiel.de/', { visitor: '4:16909060' });
    expect(again.status).toBe(202);
    expect(again.body.id).not.toBe(started.body.id);
  });

  it('a scan another visitor joined stays for that visitor and runs to its report', async () => {
    const object = objectWith(new FakeStorage());
    const first = await start(object, 'https://kaffee-beispiel.de/');
    const second = await start(object, 'https://kaffee-beispiel.de/', { visitor: '4:16909060' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, cached: true, status: 'queued', displayHost: 'kaffee-beispiel.de' });
    expect(second.body.cancelToken).toMatch(/^[a-z2-7]{26}$/);
    expect(second.body.cancelToken).not.toBe(first.body.cancelToken);
    expect(await cancel(object, first.body.id, first.body.cancelToken)).toBe('kept');
    expect((await scanRow(first.body.id)).status).toBe('queued');
    await object.alarm();
    expect(await scanRow(first.body.id)).toEqual({ status: 'done', state: 'complete', error: null, mode: 'full' });
    expect(fake.state.acquired).toBe(1);
    expect(await cancel(object, first.body.id, second.body.cancelToken)).toBe('unknown');
    expect((await scanRow(first.body.id)).status).toBe('done');
  });

  it('a running scan is not stopped: the cancel changes nothing and the report is saved', async () => {
    const object = objectWith(new FakeStorage());
    const started = await start(object, 'https://kaffee-beispiel.de/');
    let open: () => void = () => undefined;
    fake.state.captureGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const run = object.alarm();
    await waitFor(async () => (await scanRow(started.body.id)).status === 'running');
    expect((await scanRow(started.body.id)).status).toBe('running');
    expect(await cancel(object, started.body.id, started.body.cancelToken)).toBe('running');
    open();
    await run;
    expect(await scanRow(started.body.id)).toEqual({ status: 'done', state: 'complete', error: null, mode: 'full' });
    expect(fake.state.acquired).toBe(1);
  });

  it('a wrong token or a malformed request changes nothing', async () => {
    const object = objectWith(new FakeStorage());
    const started = await start(object, 'https://kaffee-beispiel.de/');
    expect(await cancel(object, started.body.id, 'a'.repeat(26))).toBe('not-holder');
    const malformed = await object.fetch(new Request('https://queue/cancel', { method: 'POST', body: JSON.stringify({ id: started.body.id, token: 'kurz' }) }));
    expect(malformed.status).toBe(500);
    expect((await scanRow(started.body.id)).status).toBe('queued');
    await object.alarm();
    expect((await scanRow(started.body.id)).status).toBe('done');
  });
});