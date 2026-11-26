import { describe, expect, it } from 'vitest';
import { limitPageSnapshot } from '../src/capture/limits.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { SCANNER_VERSION } from '../src/index.ts';
import { SNAPSHOT_MAX_ELEMENTS, snapshotFromHtml } from '../src/quick/html-snapshot.ts';
import { quickCapture } from '../src/quick/quick-capture.ts';
import { buildReport } from '../src/report/build.ts';
import { validateReport } from '../src/report/validate.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';

/**
 * Session C2 (Fedor's answer 2 after C1): the quick check's HTML reader builds at most `SNAPSHOT_MAX_ELEMENTS` elements;
 * past it the rest of the page is not read, and the snapshot and the report say so (`truncated.page`). Invented pages
 * and a fake fetch only.
 */

const SITE = 'https://www.muster-werkstatt.de/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
/** `<html>`, `<head>` and `<body>` are built for every page. */
const IMPLIED = 3;

// Short paragraphs, so the text of 20,000 of them stays within the 100,000 characters the reader keeps.
const paragraphs = (n: number): string => '<p>K</p>'.repeat(n);

describe('session C2: the limit of elements of the HTML reader', () => {
  it('is 20,000, four times the largest homepage of the 30 test sites (4,704 elements)', () => {
    expect(SNAPSHOT_MAX_ELEMENTS).toBe(20_000);
  });

  it('a page with exactly the limit is read whole; one element more and the rest is not read', () => {
    const whole = snapshotFromHtml(`${paragraphs(SNAPSHOT_MAX_ELEMENTS - IMPLIED)}<!-- Ende -->Schluss`, SITE);
    expect(whole.elementsTruncated).toBeUndefined();
    expect(whole.textTruncated).toBe(false);
    expect(whole.linksTruncated).toBe(false);
    expect(whole.text.endsWith('Schluss')).toBe(true);
    const cut = snapshotFromHtml(`${paragraphs(SNAPSHOT_MAX_ELEMENTS - IMPLIED)}<p>Schluss</p>`, SITE);
    expect(cut.elementsTruncated).toBe(true);
    expect(cut.textTruncated).toBe(true);
    expect(cut.linksTruncated).toBe(true);
    expect(cut.text.includes('Schluss')).toBe(false);
  });

  it('what came before the limit is read as before: text, links, language, title', () => {
    const html = `<!doctype html><html lang="de"><head><title>Muster Werkstatt</title></head><body><p>Willkommen <a href="/kontakt">Kontakt</a></p>${'<br>'.repeat(SNAPSHOT_MAX_ELEMENTS)}<a href="/impressum">Impressum</a>`;
    const snap = snapshotFromHtml(html, SITE);
    expect(snap.elementsTruncated).toBe(true);
    expect(snap.lang).toBe('de');
    expect(snap.title).toBe('Muster Werkstatt');
    expect(snap.text.startsWith('Willkommen Kontakt')).toBe(true);
    expect(snap.links.map((l) => l.href)).toEqual([`${SITE}kontakt`]);
  });

  it('the capture keeps the mark through its limits', () => {
    const snap = snapshotFromHtml(paragraphs(SNAPSHOT_MAX_ELEMENTS), SITE);
    expect(limitPageSnapshot(snap)?.elementsTruncated).toBe(true);
    expect(limitPageSnapshot(snapshotFromHtml(paragraphs(10), SITE))?.elementsTruncated).toBeUndefined();
  });

  it('the report: "homepage-elements" in truncated.page, and an Impressum link after the limit is a manual check, never a finding', async () => {
    const html = `<!doctype html><html lang="de"><head><title>Muster Werkstatt</title></head><body><h1>Muster Werkstatt</h1><nav><a href="/leistungen">Leistungen</a> <a href="/preise">Preise</a> <a href="/kontakt">Kontakt</a></nav><p>${'Wir reparieren Fahrräder in Musterhausen. '.repeat(60)}</p>${'<span></span>'.repeat(SNAPSHOT_MAX_ELEMENTS)}<footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></footer>`;
    const bytes = new TextEncoder().encode(html);
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('http://')) return new Response(null, { status: 301, headers: { location: SITE } });
      return new Response(bytes, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) as typeof fetch;
    const capture = await quickCapture(SITE, { guard: createUrlGuard({ resolve: async () => ['93.184.215.14'] }), userAgent: UA, fetch: fakeFetch });
    expect(capture.ok).toBe(true);
    expect(capture.page?.elementsTruncated).toBe(true);
    // The Impressum link was after the limit: not found, so no Impressum was fetched.
    expect(capture.impressum ?? null).toBeNull();
    const { report } = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-26T10:00:00.000Z', siteUrl: SITE, mode: 'quick', capture, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated });
    expect(validateReport(report)).toEqual([]);
    // One cut for the page: the lines of the text and links cuts would name limits the page did not reach.
    expect(report.truncated.page).toEqual(['homepage-elements']);
    const impressum = report.findings.find((f) => f.id === 'legal:impressum');
    expect(impressum?.textId).toBe('legal-impressum-no-link-links-cut');
    expect(impressum?.kind).toBe('manual');
    expect(impressum?.risk).toBeNull();
    expect(report.priorities).not.toContain('legal:impressum');
  });

  it('control: the same page within the limit finds the Impressum link and has no cut', async () => {
    const html = `<!doctype html><html lang="de"><body><p>Muster Werkstatt</p>${'<span></span>'.repeat(100)}<footer><a href="/impressum">Impressum</a></footer>`;
    const snap = snapshotFromHtml(html, SITE);
    expect(snap.elementsTruncated).toBeUndefined();
    expect(snap.links.map((l) => l.href)).toEqual([`${SITE}impressum`]);
  });
});
