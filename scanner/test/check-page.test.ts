import { describe, expect, it } from 'vitest';
import { analyzeCapture } from '../src/analyzers/capture.ts';
import { checkPageReason, classifyMainDocument, recheckCapture, type PageEvidence } from '../src/capture/failure.ts';
import type { PageSnapshot } from '../src/capture/types.ts';
import { loadTestRules, makeCapture } from './helpers.ts';

/**
 * Check pages of web hosts and bot protection (A2 part 2). All samples are synthetic: invented
 * texts in the style of such pages, no real site or provider names.
 */

const rules = loadTestRules();

function page(title: string, text: string, links = 0): PageEvidence {
  return { title, text, links };
}

/** About 2,000 characters of a normal homepage. */
const HOMEPAGE_TEXT = `${'Frisch gerösteter Kaffee aus unserer Rösterei in Musterstadt. Öffnungszeiten Montag bis Samstag, 8 bis 18 Uhr. '.repeat(18)}Impressum Datenschutz`;

describe('check pages with HTTP 200', () => {
  const blocked: [string, PageEvidence][] = [
    ['host check page, German', page('Einen Moment bitte …', 'Bitte warten Sie, während Ihre Anfrage geprüft wird …')],
    ['host check page with comma and dots', page('Einen Moment, bitte...', 'Ihr Browser wird überprüft. Dies dauert nur wenige Sekunden.')],
    ['short wait title with one link', page('Bitte warten', 'Wir prüfen Ihren Browser. Datenschutz', 1)],
    ['English check page', page('One moment, please...', 'Please wait while your request is being verified...')],
    ['any title, check sentence on an empty page', page('www.beispiel-handwerk.de', 'Bitte warten Sie, während Ihre Anfrage geprüft wird.')],
    ['security check title, empty body', page('Sicherheitsüberprüfung', '')],
    ['English browser check text', page('', 'Checking your browser before accessing the website. This process is automatic.')],
    ['line breaks and non-breaking spaces', page('Einen Moment\nbitte …', 'Bitte warten Sie,\nwährend Ihre Anfrage geprüft wird …')],
  ];

  it.each(blocked)('%s is blocked', (_name, evidence) => {
    const failure = classifyMainDocument(200, { 'content-type': 'text/html' }, evidence.title, evidence);
    expect(failure).toMatchObject({ reason: 'blocked', status: 200 });
    expect(failure?.message).toMatch(/^check page: /);
  });

  const normal: [string, PageEvidence][] = [
    ['a homepage whose title starts like a wait title', page('Einen Moment bitte – Café Muster in Musterstadt', HOMEPAGE_TEXT, 40)],
    ['a contact page that mentions a check of the request', page('Kontakt – Schreinerei Muster', `${HOMEPAGE_TEXT} Bitte warten Sie, während Ihre Anfrage geprüft wird.`, 25)],
    ['a thank-you page after a contact form', page('Vielen Dank', 'Vielen Dank! Ihre Anfrage wird geprüft. Wir melden uns innerhalb von 24 Stunden.', 2)],
    ['a tiny normal homepage', page('Schreinerei Muster', 'Willkommen bei der Schreinerei Muster. Telefon 01234 567890.', 2)],
    ['an article about browser checks', page('Wie Bot-Schutz funktioniert', `Checking your browser … ${HOMEPAGE_TEXT}`, 30)],
    ['a wait title on a page with many links', page('Bitte warten', 'Unsere neue Website kommt bald.', 12)],
  ];

  it.each(normal)('%s stays a normal page', (_name, evidence) => {
    expect(checkPageReason(evidence)).toBeNull();
    expect(classifyMainDocument(200, {}, evidence.title, evidence)).toBeNull();
  });

  it('needs the page text: the German wait title alone is not enough', () => {
    expect(classifyMainDocument(200, {}, 'Einen Moment bitte …')).toBeNull();
  });

  it('recognises a check page with HTTP 503 too, but keeps a maintenance page an HTTP error', () => {
    const check = page('Einen Moment bitte …', 'Bitte warten Sie, während Ihre Anfrage geprüft wird …');
    expect(classifyMainDocument(503, {}, check.title, check)).toMatchObject({ reason: 'blocked', status: 503 });
    const maintenance = page('Wartungsarbeiten – bitte warten', 'Wir sind in Kürze wieder für Sie da.');
    expect(classifyMainDocument(503, {}, maintenance.title, maintenance)).toMatchObject({ reason: 'http-error', status: 503 });
  });
});

describe('a blocked capture gives no findings', () => {
  const checkSnapshot: PageSnapshot = {
    title: 'Einen Moment bitte …',
    lang: 'en',
    text: 'Bitte warten Sie, während Ihre Anfrage geprüft wird …',
    textTruncated: false,
    links: [],
    linksTruncated: false,
  };
  const normalSnapshot: PageSnapshot = { ...checkSnapshot, title: 'Rösterei Muster', text: HOMEPAGE_TEXT, links: Array.from({ length: 30 }, (_, i) => ({ href: `https://www.example.de/${i}`, text: `Seite ${i}` })) };
  // A tracker request, so that analysing the page as a normal page would give a finding.
  const requests = [
    { url: 'https://www.example.de/', resourceType: 'document', isNavigation: true },
    { url: 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST', resourceType: 'script' },
  ];

  it('a capture saved as a normal page before the rule is decided again as blocked', () => {
    const saved = makeCapture({ requests, page: checkSnapshot });
    expect(saved.ok).toBe(true);
    const checked = recheckCapture(saved);
    expect(checked).toMatchObject({ ok: false, failure: { reason: 'blocked', status: 200 } });
    expect(saved.ok).toBe(true);
  });

  it('analysis of a check page: state blocked, no services, no findings', () => {
    const result = analyzeCapture(makeCapture({ requests, page: checkSnapshot }), rules);
    expect(result.state).toBe('blocked');
    expect(result.failure?.reason).toBe('blocked');
    expect(result.thirdParty).toBeNull();
  });

  it('the same requests on a normal page give the finding', () => {
    const normal = makeCapture({ requests, page: normalSnapshot });
    expect(recheckCapture(normal)).toBe(normal);
    const result = analyzeCapture(normal, rules);
    expect(result.state).toBe('analyzed');
    expect(result.thirdParty?.counts.findings).toBe(1);
  });

  it('a failed capture stays failed and gives no findings', () => {
    const failed = makeCapture({ requests, page: null, ok: false, failure: { reason: 'timeout', message: 'Timeout 15000 ms exceeded' } });
    expect(recheckCapture(failed)).toBe(failed);
    expect(analyzeCapture(failed, rules)).toEqual({ state: 'failed', failure: { reason: 'timeout', message: 'Timeout 15000 ms exceeded' }, thirdParty: null });
    const forbidden = makeCapture({ requests, ok: false, failure: { reason: 'blocked', message: 'HTTP 403', status: 403 } });
    expect(analyzeCapture(forbidden, rules).state).toBe('blocked');
  });
});
