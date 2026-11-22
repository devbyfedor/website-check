import { describe, expect, it } from 'vitest';
import { analyzeLegal } from '../src/analyzers/legal.ts';
import type { ImpressumCapture, PageLink, PageSnapshot } from '../src/capture/types.ts';
import { decodeCloudflareEmail, extractImpressumFields } from '../src/legal/fields.ts';
import { IMPRESSUM_SETTINGS, pollText } from '../src/legal/impressum-capture.ts';
import { chooseImpressumTarget, findLegalLinks } from '../src/legal/links.ts';
import { makeCapture, SITE } from './helpers.ts';

/** Session A4: templates, links and the analysis of mandatory information, on small invented texts. */

const found = <T>(field: { status: string; value?: T }): T | null => (field.status === 'found' ? (field.value ?? null) : null);

describe('postal address', () => {
  it('finds street, postcode and town with the exact quote', () => {
    const text = 'Impressum\nMuster GmbH\nErlenweg 12 a\n12345 Musterhausen\nTelefon: 01234 56789';
    const fields = extractImpressumFields(text);
    expect(found(fields.address)).toEqual({ street: 'Erlenweg 12 a', postcode: '12345', town: 'Musterhausen' });
    expect(fields.address.status === 'found' && fields.address.quote).toBe('Erlenweg 12 a\n12345 Musterhausen');
  });

  it('does not take phone numbers, amounts or register numbers for a postcode', () => {
    for (const text of [
      'Tel. 0871 12345 Fax 0871 12346',
      'Telefon: 98765 Musterwerk',
      'Stammkapital 25000 Euro',
      'Kundennummer 12 34567 Musterstadt',
      'HRB 12345 Amtsgericht Musterstadt',
      'Postfach 1234\n12345 Musterhausen',
      'Musterhausen, den 12.03.2026',
    ]) {
      expect(extractImpressumFields(text).address.status, text).toBe('not-found');
    }
  });

  it('cuts the town at a label or a country on the same line', () => {
    expect(found(extractImpressumFields('Am Anger 2, 12345 Musterhausen Deutschland').address)).toEqual({ street: 'Am Anger 2', postcode: '12345', town: 'Musterhausen' });
    expect(found(extractImpressumFields('Weg 3\t12345 Musterhausen\tTel. 01234 5678').address)).toEqual({ street: 'Weg 3', postcode: '12345', town: 'Musterhausen' });
    expect(found(extractImpressumFields('Hofmark 7 · 12345 Erfundenheim i.d.OPf.').address)?.town).toBe('Erfundenheim i.d.OPf.');
  });

  it('reads streets that start with umlauts after short day names, and streets above empty paragraphs', () => {
    // "Fr" and "Mo" are day abbreviations, but "Fröhliche-…" and "Mühlweg" are streets (\b does not know umlauts).
    expect(found(extractImpressumFields('Adresse: Fröhliche-Erfunden Str. 09, 12345 Musterstadt').address)?.street).toBe('Fröhliche-Erfunden Str. 09');
    expect(found(extractImpressumFields('Mühlweg 4\n12345 Musterstadt').address)?.street).toBe('Mühlweg 4');
    expect(found(extractImpressumFields('Falkenweg 12\n\n \n\n 12345 Musterdorf').address)?.street).toBe('Falkenweg 12');
    expect(extractImpressumFields('Mitglied seit 2010\n12345 Musterstadt').address.status).toBe('not-found');
    expect(extractImpressumFields('Gegründet 1998\n\n12345 Musterstadt').address.status).toBe('not-found');
  });

  it('starts the street after a company name on the same segment', () => {
    expect(found(extractImpressumFields('Beispiel GmbH Lindenstraße 4\n12345 Musterhausen').address)?.street).toBe('Lindenstraße 4');
  });

  it('skips an address that the text marks as a third party, and takes the next one', () => {
    const text = 'Webdesign:\nPixelwerk Agentur\nKlickweg 1\n11111 Agenturstadt\n\nAngaben gemäß § 5 DDG\nMuster GmbH\nErlenweg 2\n22222 Musterhausen';
    expect(found(extractImpressumFields(text).address)?.postcode).toBe('22222');
    const board = 'Verbraucherschlichtungsstelle Beispiel e.V., Schlichtweg 8, 33333 Schlichtstadt';
    expect(extractImpressumFields(board).address.status).toBe('not-found');
  });

  it('skips the address of a court or authority that stands blocks below its heading, as site builders write it', () => {
    const builder = 'Aufsichtsbehörde\n\nAmtsgericht Beispielburg - Registernummer: HRA 555\n\nGerichtsweg 1 - 12345 Beispielburg\n\n';
    expect(extractImpressumFields(builder).address.status).toBe('not-found');
    const withOperator = 'Angaben gemäß § 5 DDG:\n\nErika Muster\n\nMusterweg 8\n\n12345 Musterstadt\n\n' + builder;
    expect(found(extractImpressumFields(withOperator).address)?.street).toBe('Musterweg 8');
    // The register lines of the operator do not hide the operator's VAT ID below them.
    expect(found(extractImpressumFields('Registergericht: Amtsgericht Musterstadt\nHRB 123\n\nUSt-IdNr.: DE123456789').ustId)).toBe('DE123456789');
  });

  it('skips the venue of a course in a sidebar ("Wo:")', () => {
    const text = 'Kurse in Musterstadt\n\nWann: jeden Donnerstag 17:00-18:30\n\nWo: Gemeindesaal Musterstadt\n\nSaalweg 7, 12345 Musterstadt\n\nTel.: 01234-567890';
    expect(extractImpressumFields(text).address.status).toBe('not-found');
  });

  it('does not take a company named after a credit word for a credit line', () => {
    const text = 'Webdesign Huber GmbH\nKlickweg 1\n11111 Agenturstadt';
    expect(found(extractImpressumFields(text).address)?.postcode).toBe('11111');
  });
});

describe('e-mail', () => {
  it('finds plain, hidden and link forms', () => {
    expect(found(extractImpressumFields('E-Mail: Info@Muster.example').email)).toEqual({ value: 'info@muster.example', form: 'plain' });
    expect(found(extractImpressumFields('info [at] muster [dot] example').email)).toEqual({ value: 'info@muster.example', form: 'obfuscated' });
    expect(found(extractImpressumFields('info(at)muster.example').email)).toEqual({ value: 'info@muster.example', form: 'obfuscated' });
    expect(found(extractImpressumFields('E-Mail: info at muster dot example').email)).toEqual({ value: 'info@muster.example', form: 'obfuscated' });
    const links: PageLink[] = [{ href: 'mailto:Kontakt@Muster.example?subject=Hallo', text: 'Schreiben Sie uns' }];
    expect(found(extractImpressumFields('Kontakt: Schreiben Sie uns', links).email)).toEqual({ value: 'kontakt@muster.example', form: 'mailto' });
  });

  it('takes " at " words only with an e-mail label on the line', () => {
    expect(extractImpressumFields('Unsere Produkte gibt es at shop dot example').email.status).toBe('not-found');
  });

  it('ignores image file names and reversed text', () => {
    expect(extractImpressumFields('logo@2x.png banner@3x.webp').email.status).toBe('not-found');
    expect(extractImpressumFields('elpmaxe.retsum@ofni').email.status).toBe('not-found');
  });

  it('decodes Cloudflare e-mail protection', () => {
    const key = 0x4a;
    const hex = key.toString(16) + [...'info@muster.example'].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
    expect(decodeCloudflareEmail(hex)).toBe('info@muster.example');
    const links: PageLink[] = [{ href: `https://www.muster.example/cdn-cgi/l/email-protection#${hex}`, text: '[email protected]' }];
    expect(found(extractImpressumFields('E-Mail: [email protected]', links).email)).toEqual({ value: 'info@muster.example', form: 'cloudflare' });
  });

  it('skips the e-mail of an agency credit and its mailto link', () => {
    const text = 'Webdesign: Pixelwerk, hallo@pixelwerk.example';
    const links: PageLink[] = [{ href: 'mailto:hallo@pixelwerk.example', text: 'hallo@pixelwerk.example' }];
    expect(extractImpressumFields(text, links).email.status).toBe('not-found');
  });
});

describe('Handelsregister and USt-IdNr', () => {
  it('finds the number with the court in the usual forms', () => {
    expect(found(extractImpressumFields('Registergericht: Amtsgericht Musterstadt, HRB 12345').handelsregister)).toEqual({ register: 'HRB', number: '12345', court: 'Musterstadt' });
    expect(found(extractImpressumFields('HR B 4711, AG Beispielburg').handelsregister)).toEqual({ register: 'HRB', number: '4711', court: 'Beispielburg' });
    expect(found(extractImpressumFields('Handelsregister: HRA 99 beim Amtsgericht Musterstadt').handelsregister)).toEqual({ register: 'HRA', number: '99', court: 'Musterstadt' });
    expect(found(extractImpressumFields('HRB-Nr.: 123456 B').handelsregister)).toEqual({ register: 'HRB', number: '123456', court: null });
  });

  it('does not take a place of jurisdiction for the register court', () => {
    expect(found(extractImpressumFields('HRB 555\nGerichtsstand: Amtsgericht Musterstadt').handelsregister)?.court).toBeNull();
  });

  it('finds DE plus nine digits, not an IBAN', () => {
    expect(found(extractImpressumFields('USt-IdNr.: DE 123 456 789').ustId)).toBe('DE123456789');
    expect(extractImpressumFields('IBAN: DE89 3704 0044 0532 0130 00').ustId.status).toBe('not-found');
    expect(extractImpressumFields('DE1234567890').ustId.status).toBe('not-found');
    expect(extractImpressumFields('Steuernummer: 123/456/78901').ustId.status).toBe('not-found');
  });
});

describe('cases from the code review of the templates (22.11.2026)', () => {
  const cfHex = (address: string): string => {
    const key = 0x4a;
    return key.toString(16) + [...address].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  };

  it('checks the place of a mailto or Cloudflare link: an agency or an external DPO link is not the operator e-mail', () => {
    const agency = extractImpressumFields('Muster GmbH\nErlenweg 12\n12345 Musterhausen\n\nWebdesign: Pixelwerk', [{ href: 'mailto:hallo@pixelwerk.example', text: 'Pixelwerk' }]);
    expect(agency.email.status).toBe('not-found');
    const dpo = extractImpressumFields('Muster GmbH\nE-Mail: über unser Kontaktformular\n\nDatenschutzbeauftragter:\nDr. Daten Extern\nE-Mail schreiben', [
      { href: 'mailto:dsb@extern-datenschutz.example', text: 'E-Mail schreiben' },
    ]);
    expect(dpo.email.status).toBe('not-found');
    const cf = extractImpressumFields('Datenschutzbeauftragter:\nDr. Daten Extern\n[email protected]', [
      { href: `https://www.muster.example/cdn-cgi/l/email-protection#${cfHex('dsb@extern.example')}`, text: '[email protected]' },
    ]);
    expect(cf.email.status).toBe('not-found');
    // A link without any text counts only on the site's own domain.
    const icon = [{ href: 'mailto:info@muster.example', text: '' }];
    expect(extractImpressumFields('Muster GmbH', icon).email.status).toBe('not-found');
    expect(extractImpressumFields('Muster GmbH', icon, new Set(['muster.example'])).email.status).toBe('found');
  });

  it('takes no social handle, fediverse handle or sentence with "at" for an e-mail address', () => {
    const links = [{ href: `https://www.muster.example/cdn-cgi/l/email-protection#${cfHex('info@muster.example')}`, text: '[email protected]' }];
    const insta = extractImpressumFields('Muster GmbH\nE-Mail: [email protected]\n\nFolgen Sie uns: Instagram @cafe.muster', links);
    expect(found(insta.email)).toEqual({ value: 'info@muster.example', form: 'cloudflare' });
    expect(extractImpressumFields('Kontakt: Mastodon @verein@social.example').email.status).toBe('not-found');
    expect(extractImpressumFields('Email: use the form at www.muster.example/contact').email.status).toBe('not-found');
    expect(extractImpressumFields('info@muster.nosuchtld').email.status).toBe('not-found');
  });

  it('marks chamber and authority blocks as third parties', () => {
    const text = 'Praxis Dr. med. Erika Muster\nErlenweg 12 / 1. Stock\n12345 Musterhausen\n\nZuständige Ärztekammer:\nLandesärztekammer Musterland\nKammerweg 1\n54321 Kammerstadt';
    expect(extractImpressumFields(text).address.status).toBe('not-found');
    expect(extractImpressumFields('Mitglied der IHK Musterstadt\nKammerweg 1\n54321 Kammerstadt').address.status).toBe('not-found');
  });

  it('takes no year for a house number', () => {
    for (const text of ['Muster Bau GmbH\nMeisterbetrieb seit 1985\n\n12345 Musterstadt', 'Tradition seit 1902\n12345 Musterstadt', 'Jahrgang 2024\n12345 Musterstadt', 'Erlenweg 1234\n12345 Musterstadt']) {
      expect(extractImpressumFields(text).address.status, text).toBe('not-found');
    }
    expect(found(extractImpressumFields('Erlenweg 12\n12345 Musterstadt').address)?.street).toBe('Erlenweg 12');
    expect(found(extractImpressumFields('Musterstr.1\n12345 Musterstadt').address)?.street).toBe('Musterstr.1');
  });

  it('ends the town at a phone label or at the next word of the sentence, keeps two-word towns', () => {
    expect(found(extractImpressumFields('Erlenweg 12 12345 Musterhausen T. 0123 4567').address)?.town).toBe('Musterhausen');
    expect(found(extractImpressumFields('Erlenweg 12, 12345 Musterhausen Eingetragen im Handelsregister').address)?.town).toBe('Musterhausen');
    expect(found(extractImpressumFields('Erlenweg 12, 12345 Bad Musterhausen').address)?.town).toBe('Bad Musterhausen');
    expect(found(extractImpressumFields('Erlenweg 12, 12345 Musterstadt am Main').address)?.town).toBe('Musterstadt am Main');
  });

  it('reads the legal form "AG" not as the court, a Gerichtsstand clause not as the register court', () => {
    expect(found(extractImpressumFields('Muster AG Vorstand Max Muster HRB 123').handelsregister)?.court).toBeNull();
    const clause = 'Muster GmbH\nHandelsregister: HRB 12345\nGerichtsstand für alle Streitigkeiten ist das Amtsgericht Freising';
    expect(found(extractImpressumFields(clause).handelsregister)?.court).toBeNull();
  });

  it('skips the register entry of the general partner and keeps thousands dots', () => {
    const kg = 'Persönlich haftende Gesellschafterin: Muster Verwaltungs GmbH, Amtsgericht Musterstadt, HRB 5678\nMuster GmbH & Co. KG, Amtsgericht Musterstadt, HRA 1234';
    expect(found(extractImpressumFields(kg).handelsregister)).toEqual({ register: 'HRA', number: '1234', court: 'Musterstadt' });
    expect(found(extractImpressumFields('HRB 12.345 Amtsgericht Musterstadt').handelsregister)).toEqual({ register: 'HRB', number: '12345', court: 'Musterstadt' });
  });

  it('stays fast on one long line with many postcodes or third-party candidates', () => {
    for (const text of ['12345 Musterstadt, '.repeat(5_000), `Webdesign: ${'a@b.de '.repeat(14_000)}`, `Webdesign: ${'HRB 12345 '.repeat(10_000)}`]) {
      const started = performance.now();
      extractImpressumFields(text);
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});

describe('templates on long or strange texts', () => {
  it('stay fast: no pattern backtracks for long on repeated small words or 100,000 characters', () => {
    const texts = [
      `12345 Musterstadt${' i. d.'.repeat(40)}`,
      `HRB 1 Amtsgericht Muster${' a.d.'.repeat(40)}`,
      'a'.repeat(100_000),
      `${' '.repeat(50_000)}12345 Musterstadt${' '.repeat(50_000)}`,
      '1 '.repeat(50_000),
      'Musterweg 3\n12345 Musterstadt\n'.repeat(3_000),
    ];
    for (const text of texts) {
      const started = performance.now();
      extractImpressumFields(text);
      expect(performance.now() - started, text.slice(0, 30)).toBeLessThan(1_000);
    }
  });
});

describe('legal links', () => {
  const links: PageLink[] = [
    { href: `${SITE}impressum-alt`, text: 'Impressum', footer: false },
    { href: `${SITE}#`, text: 'Datenschutz-Einstellungen', footer: true },
    { href: `${SITE}#`, text: 'Barrierefreiheit', footer: false },
    { href: 'javascript:void(0)', text: 'Impressum', footer: true },
    { href: `${SITE}impressum`, text: 'Impressum', footer: true },
    { href: `${SITE}datenschutz`, text: 'Datenschutzerklärung', footer: true },
    { href: `${SITE}barrierefreiheit`, text: 'Erklärung zur Barrierefreiheit', footer: true },
  ];

  it('takes the footer link, never javascript:, a bare # or consent settings', () => {
    const found = findLegalLinks(links, SITE);
    expect(found.impressum?.href).toBe(`${SITE}impressum`);
    expect(found.datenschutz?.href).toBe(`${SITE}datenschutz`);
    expect(found.accessibilityStatement?.href).toBe(`${SITE}barrierefreiheit`);
  });

  it('marks an accessibility link that names only the topic as uncertain, and prefers a statement', () => {
    const topic: PageLink = { href: `${SITE}digitale-barrierefreiheit/`, text: 'Digitale Barrierefreiheit', footer: true };
    expect(findLegalLinks([topic], SITE).accessibilityStatement).toMatchObject({ href: topic.href, certain: false });
    const statement: PageLink = { href: `${SITE}barrierefreiheit`, text: 'Erklärung zur Barrierefreiheit', footer: true };
    expect(findLegalLinks([topic, statement], SITE).accessibilityStatement).toMatchObject({ href: statement.href, certain: true });
    const byAddress: PageLink = { href: `${SITE}barrierefreiheitserklaerung`, text: 'Barrierefreiheit', footer: true };
    expect(findLegalLinks([byAddress], SITE).accessibilityStatement?.certain).toBe(true);
    expect(findLegalLinks(links, SITE).impressum?.certain).toBe(true);
  });

  it('never guesses an address when there is no link', () => {
    expect(chooseImpressumTarget([{ href: `${SITE}kontakt`, text: 'Kontakt' }], SITE)).toEqual({ action: 'none' });
  });
});

describe('analyzeLegal', () => {
  const page = (links: PageLink[], text = 'Startseite'): PageSnapshot => ({ title: 'Start', lang: 'de', text, textTruncated: false, links, linksTruncated: false });
  const tab = (url: string, text: string, ok = true): ImpressumCapture => ({
    url,
    ok,
    failure: ok ? null : { reason: 'timeout', message: 'Timeout' },
    finalUrl: url,
    status: ok ? 200 : null,
    page: ok ? page([], text) : null,
    requestCount: 3,
    timings: { openedAtMs: 4000, domContentLoadedMs: 300, snapshotMs: 900, totalMs: 1000, stopReason: ok ? 'text-stable' : 'error' },
  });
  const impressumLink: PageLink = { href: `${SITE}impressum`, text: 'Impressum', footer: true };

  it('searches the Impressum text from the second tab', () => {
    const capture = makeCapture({ requests: [], page: page([impressumLink]), impressum: tab(`${SITE}impressum`, 'Muster GmbH\nWeg 1\n12345 Musterhausen\ninfo@muster.example') });
    const legal = analyzeLegal(capture);
    expect(legal.impressum.state).toBe('analyzed');
    expect(legal.fields.address.status).toBe('found');
    expect(legal.fields.email.status).toBe('found');
    expect(legal.fields.ustId).toEqual({ status: 'not-found', reason: 'not-on-page' });
  });

  it('gives every field "not checked" reasons when there is no Impressum text', () => {
    const states = [
      [makeCapture({ requests: [], page: page([]) }), 'no-link'],
      [makeCapture({ requests: [], page: page([impressumLink]) }), 'not-captured'],
      [makeCapture({ requests: [], page: page([impressumLink]), impressum: tab(`${SITE}impressum`, '', false) }), 'failed'],
      [makeCapture({ requests: [], page: page([{ href: `${SITE}impressum.pdf`, text: 'Impressum' }]) }), 'pdf'],
    ] as const;
    for (const [capture, state] of states) {
      const legal = analyzeLegal(capture);
      expect(legal.impressum.state).toBe(state);
      expect(legal.fields.address).toEqual({ status: 'not-found', reason: 'impressum-not-checked' });
    }
  });

  it('does not search the whole homepage for an anchor link (manual check), and marks an Impressum on another site', () => {
    // A one-page site: the homepage text also holds client projects, so its first address is not the operator's.
    const onePager = makeCapture({ requests: [], page: page([{ href: `${SITE}#impressum`, text: 'Impressum' }], 'Referenzen\nSchulweg 5\n12345 Altdorf\n\nImpressum\nWeg 1\n54321 Musterhausen') });
    const legal = analyzeLegal(onePager);
    expect(legal.impressum.state).toBe('same-page');
    expect(legal.fields.address).toEqual({ status: 'not-found', reason: 'impressum-not-checked' });
    const other = 'https://www.konzern.example/impressum';
    const cross = analyzeLegal(makeCapture({ requests: [], page: page([{ href: other, text: 'Impressum' }]), impressum: tab(other, 'Konzern AG') }));
    expect(cross.impressum.crossSite).toBe(true);
  });

  it('ignores placeholder links that open a modal, and an Impressum link that leads back to the homepage', () => {
    for (const href of [`${SITE}#!`, `${SITE}#0`, `${SITE}#`, SITE]) {
      expect(analyzeLegal(makeCapture({ requests: [], page: page([{ href, text: 'Impressum', footer: true }]) })).impressum.state, href).toBe('no-link');
    }
    const back = tab(`${SITE}impressum`, 'Willkommen\nMuster GmbH\nWeg 1\n12345 Musterhausen');
    back.finalUrl = SITE;
    const legal = analyzeLegal(makeCapture({ requests: [], page: page([impressumLink]), impressum: back }));
    expect(legal.impressum.state).toBe('failed');
    expect(legal.fields.address).toEqual({ status: 'not-found', reason: 'impressum-not-checked' });
  });

  it('does not report missing links when the homepage text could not be read', () => {
    const legal = analyzeLegal(makeCapture({ requests: [], page: null }));
    expect(legal).toMatchObject({ homepageRead: false, impressum: { state: 'not-captured' } });
  });

  it('prefers an exact "Impressum" link over a footer article title that contains the word, and needs a whole word in an address', () => {
    const title: PageLink = { href: `${SITE}blog/was-gehoert-ins-impressum`, text: 'Was gehört ins Impressum? 7 Tipps', footer: true };
    const header: PageLink = { href: `${SITE}impressum`, text: 'Impressum', footer: false };
    expect(findLegalLinks([title, header], SITE).impressum?.href).toBe(header.href);
    expect(findLegalLinks([title], SITE).impressum).toBeNull();
    const teaser: PageLink = { href: `${SITE}blog/impressumspflicht-auf-instagram`, text: 'Weiterlesen', footer: true };
    expect(findLegalLinks([teaser], SITE).impressum).toBeNull();
    const icon: PageLink = { href: `${SITE}rechtliches/impressum.html`, text: '', footer: true };
    expect(findLegalLinks([icon], SITE).impressum?.matchedBy).toBe('href');
  });

  it('takes the accessibility statement link from the Impressum page when the homepage has none', () => {
    const impressum = tab(`${SITE}impressum`, 'Muster GmbH');
    impressum.page = page([{ href: `${SITE}barrierefreiheit`, text: 'Barrierefreiheitserklärung', footer: true }], 'Muster GmbH');
    const legal = analyzeLegal(makeCapture({ requests: [], page: page([impressumLink]), impressum }));
    expect(legal.accessibilityStatement).toMatchObject({ href: `${SITE}barrierefreiheit`, page: 'impressum' });
  });
});

describe('waiting for the Impressum text', () => {
  it('stops when the text keeps its length after the load event, or at the limit', () => {
    let step = pollText({ length: -1, changedAtMs: 0 }, 500, true, 0);
    expect(step.done).toBeNull();
    step = pollText(step.watch, 500, true, 250);
    expect(step.done).toBeNull();
    step = pollText(step.watch, 500, true, 500);
    expect(step.done).toBe('text-stable');
    const growing = pollText({ length: 100, changedAtMs: 0 }, 900, false, 1000);
    expect(growing.done).toBeNull();
    expect(pollText(growing.watch, 900, false, IMPRESSUM_SETTINGS.maxSettleMs).done).toBe('max-wait');
  });

  it('waits longer for a text before the load event', () => {
    expect(pollText({ length: 500, changedAtMs: 0 }, 500, false, 1000).done).toBeNull();
    expect(pollText({ length: 500, changedAtMs: 0 }, 500, false, 1500).done).toBe('text-stable');
  });
});
