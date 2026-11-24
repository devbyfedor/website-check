import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Capture } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { extractImpressumFields } from '../src/legal/fields.ts';
import { buildReport } from '../src/report/build.ts';
import type { Report } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';
import { SCANNER_ROOT } from './helpers.ts';
import { axeResult, SHOP, SHOP_URL, shopCapture } from './report-helpers.ts';

/**
 * Session fix-a6: strings of the scanned page in the report, review findings 28, 52, 53, 58 and 59. The scenarios of the
 * review on synthetic captures of invented sites.
 */

function report(capture: Capture): Report {
  const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SHOP_URL, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(built.report)).toEqual([]);
  return built.report;
}

const base = shopCapture();
const page = base.page as NonNullable<Capture['page']>;

describe('finding 28: evidence.via holds only a web address', () => {
  for (const initiator of ['javascript:alert(document.domain)//', '"><img/src=x/onerror=alert(1)>', 'main.js', `JaVaScRiPt:${'a'.repeat(400)}`, 'about:blank', 'blob:https://www.roesterei-muster.example/x']) {
    it(`an initiator ${JSON.stringify(initiator.slice(0, 30))} gives via null`, () => {
      const r = report(shopCapture({ requests: [...base.requests, { ...base.requests[0], seq: 99, url: 'http://px.tracker-eins.example/a.gif', resourceType: 'image', isNavigation: false, startMs: 600, endMs: 650, initiator: { type: 'script', url: initiator } }] as never }));
      const f = r.findings.find((x) => x.serviceKey === 'unknown:tracker-eins.example');
      expect(f?.evidence[0]).toMatchObject({ type: 'request', via: null });
    });
  }

  it('control: an https initiator stays, without its query', () => {
    const r = report(shopCapture({ requests: [...base.requests, { ...base.requests[0], seq: 99, url: 'http://px.tracker-eins.example/a.gif', resourceType: 'image', isNavigation: false, startMs: 600, endMs: 650, initiator: { type: 'script', url: 'https://cdn.tracker-eins.example/t.js?id=1' } }] as never }));
    expect(r.findings.find((x) => x.serviceKey === 'unknown:tracker-eins.example')?.evidence[0]).toMatchObject({ via: 'https://cdn.tracker-eins.example/t.js' });
  });
});

/** Cloudflare's e-mail protection: the first byte is the key, every following byte is a character XOR the key. */
function cloudflareHex(address: string, key = 0x42): string {
  return [key, ...[...address].map((c) => c.charCodeAt(0) ^ key)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('finding 52: the e-mail quote is the address, never a link with a script or markup', () => {
  it('a javascript: link with Cloudflare\'s path is no e-mail', () => {
    const fields = extractImpressumFields('Impressum\nMax Muster\nSchreiben Sie uns', [{ href: `javascript:alert(document.domain)//cdn-cgi/l/email-protection#${cloudflareHex('info@muster.example')}`, text: 'Schreiben Sie uns' }], new Set(['muster.example']));
    expect(fields.email.status).toBe('not-found');
  });

  it('a Cloudflare link of another site is no e-mail of the operator; one of the site itself is, quoted as the address', () => {
    const hex = cloudflareHex('info@muster.example');
    const other = extractImpressumFields('Impressum\nMax Muster\nSchreiben Sie uns', [{ href: `https://andere-seite.example/cdn-cgi/l/email-protection#${hex}`, text: 'Schreiben Sie uns' }], new Set(['muster.example']));
    expect(other.email.status).toBe('not-found');
    const own = extractImpressumFields('Impressum\nMax Muster\nSchreiben Sie uns', [{ href: `https://www.muster.example/cdn-cgi/l/email-protection#${hex}`, text: 'Schreiben Sie uns' }], new Set(['muster.example']));
    expect(own.email).toMatchObject({ status: 'found', quote: 'info@muster.example', source: 'link' });
  });

  it('a mailto link with markup after the address is quoted as the address only', () => {
    const fields = extractImpressumFields('Impressum\nMax Muster\nE-Mail', [{ href: 'mailto:info@muster.example,<img src=x onerror=alert(1)>?subject=x', text: 'E-Mail' }], new Set(['muster.example']));
    expect(fields.email).toMatchObject({ status: 'found', quote: 'info@muster.example', source: 'link' });
  });

  it('the report says where the quote comes from', () => {
    const r = report(shopCapture());
    expect(r.legal?.fields.email).toMatchObject({ status: 'found', source: 'text' });
  });
});

describe('finding 53: link addresses without user name and password, never shortened', () => {
  it('a Datenschutz link with a user name that reads like an authority is stored without it', () => {
    const r = report(shopCapture({ page: { ...page, links: [...page.links.filter((l) => l.text !== 'Datenschutz'), { href: 'http://www.bundesnetzagentur.de:x@www.roesterei-muster.example/datenschutz', text: 'Datenschutz', footer: true }] } }));
    expect(r.legal?.datenschutzLink?.href).toBe('http://www.roesterei-muster.example/datenschutz');
  });

  it('an address longer than the report keeps is null, not cut with "…"', () => {
    const long = `${SHOP}impressum/${'%C3%A4'.repeat(60)}`;
    const r = report(shopCapture({ page: { ...page, links: [...page.links.filter((l) => l.text !== 'Impressum'), { href: long, text: 'Impressum', footer: true }] }, impressum: { ...(base.impressum as NonNullable<Capture['impressum']>), url: long, finalUrl: long } }));
    expect(r.legal?.impressumLink).toMatchObject({ href: null, text: 'Impressum' });
    expect(r.legal?.impressum.url).toBeNull();
    expect(JSON.stringify(r.legal)).not.toContain('…');
  });
});

describe('finding 58: cut strings are well formed and free of invisible controls', () => {
  it('an HTML snippet cut inside an emoji, and a quote with controls and bidi characters', () => {
    const html = `<img src="/a.jpg" alt="${'a'.repeat(175)}\u{1F600}`.slice(0, 199);
    const axe = axeResult();
    const image = axe.rules['image-alt'];
    if (image === undefined) throw new Error('fixture');
    const r = report(
      shopCapture({
        axe: { ...axe, rules: { ...axe.rules, 'image-alt': { ...image, examples: [{ target: ['img'], html, contrast: null }] } } },
        page: { ...page, links: [...page.links.filter((l) => l.text !== 'Datenschutz'), { href: `${SHOP}datenschutz/`, text: 'Daten\u0000schutz‮gnp.exe​', footer: true }] },
      }),
    );
    const evidence = r.findings.find((f) => f.id === 'a11y:image-alt')?.evidence[0];
    const snippet = evidence?.type === 'element' ? evidence.html : '';
    // A lone surrogate (what String.prototype.isWellFormed of ES2024 looks for).
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(snippet)).toBe(false);
    expect(snippet.endsWith('�') || snippet.endsWith('…')).toBe(true);
    expect(() => encodeURIComponent(snippet)).not.toThrow();
    expect(r.legal?.datenschutzLink?.text).toBe('Datenschutzgnp.exe');
    expect(JSON.stringify(r)).not.toMatch(/[\u0000-\u0008\u000B-\u001F‪-‮⁦-⁩]/);
  });
});

describe('finding 59: the schema marks every field with text or markup of the page', () => {
  const schema = JSON.parse(readFileSync(resolve(SCANNER_ROOT, 'schema/report.v1.schema.json'), 'utf8')) as Record<string, unknown>;
  const at = (path: string[]): Record<string, unknown> => path.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, schema);
  const evidence = (n: number): string[] => ['$defs', 'evidence', 'oneOf', String(n), 'properties'];
  const fields: [string, string[]][] = [
    ['site.finalUrl', ['properties', 'site', 'properties', 'finalUrl']],
    ['evidence.url', [...evidence(0), 'url']],
    ['evidence.via', [...evidence(0), 'via']],
    ['evidence.target', [...evidence(1), 'target']],
    ['evidence.html', [...evidence(1), 'html']],
    ['evidence.value', [...evidence(2), 'value']],
    ['finding.params', ['$defs', 'finding', 'properties', 'params']],
    ['finding.serviceKey', ['$defs', 'finding', 'properties', 'serviceKey']],
    ['service.key', ['$defs', 'service', 'properties', 'key']],
    ['service.name', ['$defs', 'service', 'properties', 'name']],
    ['service.hosts', ['$defs', 'service', 'properties', 'hosts']],
    ['link.href', ['$defs', 'link', 'properties', 'href']],
    ['link.text', ['$defs', 'link', 'properties', 'text']],
    ['fieldState.quote', ['$defs', 'fieldState', 'oneOf', '0', 'properties', 'quote']],
    ['section.reason', ['$defs', 'section', 'properties', 'reason']],
  ];
  for (const [name, path] of fields) {
    it(`${name} has a description that says it is untrusted`, () => {
      expect(String(at(path)['description'] ?? '')).toMatch(/untrusted|for the log/);
    });
  }

  it('docs/report-schema.md has the rules for showing the strings of the page', () => {
    const doc = readFileSync(resolve(SCANNER_ROOT, '../docs/report-schema.md'), 'utf8');
    expect(doc).toContain('## Strings of the scanned page');
    for (const word of ['dangerouslySetInnerHTML', 'rel="noopener noreferrer nofollow"', 'toWellFormed', 'writeText', 'bdi']) expect(doc).toContain(word);
  });
});
