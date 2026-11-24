import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { SCANNER_VERSION } from '../src/index.ts';
import { buildReport } from '../src/report/build.ts';
import { validateReport } from '../src/report/validate.ts';
import { SHOP_URL, shopCapture } from './report-helpers.ts';

/**
 * Session B2 part 2: `scan.requests` for the row "17 Anfragen aufgezeichnet, davon 9 an fremde Server" of the scan
 * screen. The numbers are those of the third-party analysis: http and https requests of the homepage, `data:` and
 * `blob:` not counted; null when the part was not checked; a report made before (without the field) stays valid.
 */

const build = (mode: 'full' | 'quick' = 'full') =>
  buildReport({
    id: 'abcdefghijklmnopqrstuvwxyz',
    createdAt: '2026-11-20T11:59:58.000Z',
    siteUrl: SHOP_URL,
    mode,
    capture: mode === 'quick' ? { ...shopCapture(), adapter: 'quick-fetch', axe: null } : shopCapture(),
    rules: DEFAULT_RULES,
    scannerVersion: SCANNER_VERSION,
    rulesUpdated: RULES_FILE.updated,
    visit: { country: 'IT', colo: 'MXP' },
  });

describe('scan.requests (session B2 part 2)', () => {
  it('counts the http and https requests of the homepage and those to third parties, as the analysis does', () => {
    const { report, analysis } = build();
    const counts = analysis.thirdParty?.counts;
    expect(counts).toBeDefined();
    expect(report.scan.requests).toEqual({ total: (counts?.firstPartyRequests ?? 0) + (counts?.thirdPartyRequests ?? 0), thirdParty: counts?.thirdPartyRequests });
    expect(report.scan.requests?.thirdParty).toBeGreaterThan(0);
    expect(report.scan.requests?.total).toBeGreaterThan(report.scan.requests?.thirdParty ?? 0);
    expect(validateReport(report)).toEqual([]);
  });

  it('is null when the third-party part was not checked (quick check), and a report without the field stays valid', () => {
    const { report } = build('quick');
    expect(report.state).toBe('quick');
    expect(report.scan.requests).toBeNull();
    expect(validateReport(report)).toEqual([]);
    const older = structuredClone(build().report) as { scan: Record<string, unknown> };
    delete older.scan.requests;
    expect(validateReport(older)).toEqual([]);
    const wrong = structuredClone(build().report) as { scan: Record<string, unknown> };
    wrong.scan.requests = { total: 3, thirdParty: -1 };
    expect(validateReport(wrong).length).toBeGreaterThan(0);
  });
});
