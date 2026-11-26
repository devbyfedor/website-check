import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchLocalBrowser } from '../../src/local/index.ts';
import { BAD_PORTS } from '../../src/local/ports.ts';

// Session C0 part 2: Chrome refuses an address on each bad port before any connection (net::ERR_UNSAFE_PORT). The
// final run of C0 lost 34 of 36 tests of the CDP capture that way: the fixture server had got such a port from the
// operating system. The global setup of the integration tests holds these ports (scanner/test/support/hold-bad-ports.ts).

let browser: Browser;

beforeAll(async () => {
  browser = await launchLocalBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe('the bad ports in Chrome (session C0 part 2)', () => {
  it('Chrome refuses each of them with net::ERR_UNSAFE_PORT', async () => {
    const page = await browser.newPage();
    const refused: number[] = [];
    for (const port of BAD_PORTS) {
      const error = await page.goto(`http://127.0.0.1:${port}/`, { timeout: 10_000 }).then(
        () => null,
        (e: unknown) => String(e),
      );
      if (error?.includes('net::ERR_UNSAFE_PORT')) refused.push(port);
    }
    await page.close();
    // The Chromium of Playwright 1.65 does not refuse yet the two ports the standard added last (4190, 6679), which the
    // fetch of Node refuses (scanner/test/ports.test.ts): the hold keeps all 19.
    expect(BAD_PORTS.filter((port) => !refused.includes(port)).every((port) => port === 4190 || port === 6679)).toBe(true);
    expect(refused.length).toBeGreaterThanOrEqual(17);
  });
});
