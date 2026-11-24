import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { extractImpressumFields, type FieldResult } from '../src/legal/fields.ts';
import { buildReport } from '../src/report/build.ts';
import { validateReport } from '../src/report/validate.ts';
import { SHOP_URL, shopCapture } from './report-helpers.ts';

/**
 * Session fix-a3: a field of the Impressum is the operator's own value or "nicht gefunden" (review
 * findings 5 and 16, and the small findings 71 to 74). The texts are those of the review's reproductions:
 * invented firms, invented towns, reserved `.example` names.
 */

const quote = (f: FieldResult<unknown>): string | null => (f.status === 'found' ? f.quote : null);
const value = <T>(f: FieldResult<T>): T | null => (f.status === 'found' ? f.value : null);
const all = (text: string, links: { href: string; text: string }[] = [], own: string[] = []) => {
  const r = extractImpressumFields(text, links, new Set(own));
  return { address: quote(r.address), email: quote(r.email), handelsregister: quote(r.handelsregister), ustId: quote(r.ustId) };
};
const NOTHING = { address: null, email: null, handelsregister: null, ustId: null };

function shopReport(text: string) {
  const base = shopCapture();
  const capture = shopCapture({ impressum: { ...base.impressum!, page: { ...base.impressum!.page!, text } } });
  const { report } = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SHOP_URL, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(report)).toEqual([]);
  return {
    found: Object.entries(report.legal!.fields).filter(([, f]) => f.status === 'found').map(([k]) => k),
    measure: report.measures.find((m) => m.id === 'impressum-fields'),
    manual: report.findings.filter((f) => f.textId === 'legal-field-not-found').map((f) => f.params['field']),
  };
}

const HOSTER = ['Hostwerk GmbH, Serverweg 5, 22222 Rechenstadt', 'Amtsgericht Rechenstadt, HRB 4242, USt-IdNr. DE888888888', 'abuse@hostwerk.example'];
const SOLE_TRADER = (addressLines: string[], label: string) =>
  ['Impressum', '', 'Angaben gemäß § 5 DDG', '', 'Erika Muster', 'Rösterei Muster', ...addressLines, '', 'Kontakt', 'Telefon: 01234 567890', 'Kontaktformular: siehe Kontaktseite', '', 'Kleinunternehmerin nach § 19 UStG, daher keine Umsatzsteuer-Identifikationsnummer.', '', label, ...HOSTER].join('\n');

describe('finding 5: the data of the next block is not the operator\'s', () => {
  it('a sole trader whose address the template does not read: the hoster\'s address, e-mail, register and VAT id are not reported', () => {
    const text = SOLE_TRADER(['Bohnenweg 12', 'Hinterhaus', '87654 Musterhausen'], 'Hosting-Provider');
    expect(all(text)).toEqual(NOTHING);
    const r = shopReport(text);
    expect(r.found).toEqual([]);
    expect(r.measure).toMatchObject({ result: 'manual', actual: { type: 'of', count: 0, total: 4 } });
    expect(r.manual).toEqual(['address', 'email', 'handelsregister', 'ustId']);
  });

  it('the same without any label above the other firm, and with a label of the old list', () => {
    expect(all(SOLE_TRADER(['Bohnenweg 12', 'Hinterhaus', '87654 Musterhausen'], 'Technik und Betrieb der Server'))).toEqual(NOTHING);
    expect(all(['Impressum', '', 'Erika Muster', 'Bohnenweg 12', 'Hinterhaus', '87654 Musterhausen', '', 'Hosting:', ...HOSTER].join('\n'))).toEqual(NOTHING);
  });

  it('control: with a readable address the operator\'s address is found, and still nothing of the hoster', () => {
    const text = SOLE_TRADER(['Bohnenweg 12', '87654 Musterhausen'], 'Technik und Betrieb der Server');
    expect(all(text)).toEqual({ ...NOTHING, address: 'Bohnenweg 12\n87654 Musterhausen' });
    expect(shopReport(text).measure).toMatchObject({ result: 'manual', actual: { type: 'of', count: 1, total: 4 } });
  });

  it('a table layout the address template does not read: the payment provider\'s address is not the operator\'s', () => {
    const text = ['Impressum', '', 'Firma\tRösterei Muster GmbH', 'Straße\tBohnenweg 12', 'PLZ / Ort\t87654 Musterhausen', 'E-Mail\tkontakt@roesterei-muster.example', 'Handelsregister\tHRB 12345, Amtsgericht Beispielburg', 'USt-IdNr.\tDE123456789', '', 'Zahlungsabwicklung über Zahlfix GmbH, Geldweg 3, 33333 Zahlstadt'].join('\n');
    expect(all(text)).toEqual({ address: null, email: 'kontakt@roesterei-muster.example', handelsregister: 'HRB 12345, Amtsgericht Beispielburg', ustId: 'DE123456789' });
  });

  const OWNER_UNREAD = 'Impressum\n\nAngaben gemäß § 5 DDG\n\nMuster Handwerk GmbH\nErlenweg 12\nGebäude B\n12345 Musterhausen\n\nKontakt\nTelefon: 01234 567890\nE-Mail: info@muster-handwerk.example\n\n';
  const OWNER_READ = OWNER_UNREAD.replace('Gebäude B\n', '');
  const FOREIGN: Record<string, string> = {
    'hoster in a privacy sentence': 'Hosting\n\nWir hosten die Inhalte unserer Website bei folgendem Anbieter:\n\nAnbieter ist die Hostwerk SE, Serverweg 5, 22222 Rechenstadt (nachfolgend Hostwerk).',
    'hoster sentence': 'Unser Hoster ist die Hostwerk GmbH, Serverweg 5, 22222 Rechenstadt.',
    'Hosting-Provider': 'Hosting-Provider: Hostwerk GmbH, Serverweg 5, 22222 Rechenstadt',
    Webhoster: 'Webhoster:\nHostwerk GmbH\nServerweg 5\n22222 Rechenstadt',
    Internetagentur: 'Internetagentur\nPixelwerk GmbH\nKlickweg 1\n11111 Agenturstadt',
    'heading "Webseite"': 'Webseite\nPixelwerk GmbH\nKlickweg 1\n11111 Agenturstadt',
    Gewerbeaufsicht: 'Zuständige Gewerbeaufsicht:\nLandratsamt Musterkreis\nAmtsweg 3\n44444 Kreisstadt',
    Betriebshaftpflicht: 'Betriebshaftpflicht: Sicher AG\nPolicenweg 4\n66666 Policenstadt',
    'data protection authority': 'Beschwerderecht\n\nSie können sich an die Landesbeauftragte für Datenschutz wenden:\n\nLandesbeauftragte für Datenschutz Beispielland\nBehördenweg 9\n55555 Landstadt',
    'payment provider': 'Zahlungsabwicklung über Zahlfix GmbH, Geldweg 3, 33333 Zahlstadt',
    'returns address': 'Rücksendungen bitte an: Logistik Lager GmbH, Lagerstr. 12, 44444 Lagerstadt',
    'arbitration board, label three paragraphs above': 'Verbraucherstreitbeilegung\n\nWir sind nicht verpflichtet, an Verfahren teilzunehmen.\n\nZuständig wäre:\n\nZentrum Beispiel e.V.\n\nBrückenstraße 8\n\n77777 Grenzstadt am Fluss',
    'a firm without any label': 'Sternwerk GmbH\nPunkteweg 15\n33333 Sternstadt',
  };

  it.each(Object.entries(FOREIGN))('address of %s after an operator address the template does not read: not found', (_name, block) => {
    expect(quote(extractImpressumFields(OWNER_UNREAD + block).address)).toBeNull();
  });

  it.each(Object.entries(FOREIGN))('address of %s after a readable operator address: the operator\'s', (_name, block) => {
    expect(quote(extractImpressumFields(OWNER_READ + block).address)).toBe('Erlenweg 12\n12345 Musterhausen');
  });

  const OWNER = 'Impressum\n\nAngaben gemäß § 5 DDG\n\nErika Muster\nBohnenweg 12\n87654 Musterhausen\n\nTelefon: 01234 567890\n\n';

  it('register entry, VAT id and e-mail below the address of an agency or a service provider are not the operator\'s', () => {
    const credit = `${OWNER}Webdesign & Entwicklung:\nPixelwerk GmbH\nMax Beispiel\nKlickweg 1\n11111 Agenturstadt\n\nAmtsgericht Agenturstadt, HRB 4242\nUSt-IdNr. DE888888888\nhallo@pixelwerk.example`;
    expect(all(credit)).toEqual({ ...NOTHING, address: 'Bohnenweg 12\n87654 Musterhausen' });
    const provider = `${OWNER}Bewertungen\n\nWir verwenden einen Bewertungsbutton des Dienstleisters Sternwerk GmbH, Punkteweg 15, 33333 Sternstadt, Email: info@sternwerk.example`;
    expect(all(provider).email).toBeNull();
    const noLabel = `${OWNER}Sternwerk GmbH\nPunkteweg 15\n33333 Sternstadt\nHRB 77, Amtsgericht Sternstadt\nUSt-IdNr. DE999999999\ninfo@sternwerk.example`;
    expect(all(noLabel)).toEqual({ ...NOTHING, address: 'Bohnenweg 12\n87654 Musterhausen' });
  });

  it('after the other firm\'s address an e-mail counts only on the site\'s own domain', () => {
    const text = `${OWNER}Sternwerk GmbH\nPunkteweg 15\n33333 Sternstadt\ninfo@sternwerk.example\n\nSchreiben Sie uns: post@roesterei-muster.example`;
    expect(all(text, [], ['roesterei-muster.example']).email).toBe('post@roesterei-muster.example');
    expect(all(text).email).toBeNull();
  });

  it('a heading "Datenschutz" above an external officer marks the block, unless the word is a menu link of the page', () => {
    const text = `${OWNER}Datenschutz\nDSB Beratung GmbH\nkontakt@dsb-beratung.example`;
    expect(all(text).email).toBeNull();
    // With a menu link "Datenschutz" the line can be the menu: the old behaviour stays.
    expect(all(text, [{ href: 'https://www.roesterei-muster.example/datenschutz/', text: 'Datenschutz' }]).email).toBe('kontakt@dsb-beratung.example');
  });

  it('the register entry of the general partner is not the operator\'s, also below a label some lines above or after an entry without "HRA"', () => {
    const lines = 'Muster GmbH & Co. KG\nBohnenweg 12\n87654 Musterhausen\n\nKomplementärin: Muster Verwaltungs GmbH\nSitz: Musterhausen\nGeschäftsführerin: Erika Muster\nRegistergericht: Amtsgericht Beispielburg\nHRB 9999';
    expect(all(lines).handelsregister).toBeNull();
    const unnamed = 'Muster GmbH & Co. KG\nBohnenweg 12\n87654 Musterhausen\n\nHandelsregister A, Registernummer 1234\nRegistergericht: Amtsgericht Beispielburg\n\nVertreten durch:\nMuster Verwaltungs GmbH\nBohnenweg 12\n87654 Musterhausen\n\nDiese vertreten durch:\nErika Muster\n\nHandelsregister: HRB 9999';
    expect(all(unnamed).handelsregister).toBeNull();
    // Control: the KG's own HRA below the line of the general partner is found.
    expect(value(extractImpressumFields('Muster GmbH & Co. KG\nKomplementärin: Muster Verwaltungs GmbH\nGeschäftsführerin: Erika Muster\nHandelsregister: HRA 1234, Amtsgericht Beispielburg').handelsregister)).toEqual({ register: 'HRA', number: '1234', court: 'Beispielburg' });
  });

  it('controls: the usual layouts keep all four fields', () => {
    const full = 'Impressum\n\nAngaben gemäß § 5 DDG\n\nMuster Handwerk GmbH\nErlenweg 12\n12345 Musterhausen\n\nKontakt\nE-Mail: info@muster-handwerk.example\n\nRegistereintrag\nRegistergericht: Amtsgericht Beispielburg\nRegisternummer: HRB 4711\n\nUmsatzsteuer-ID\nUmsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:\nDE123456788';
    const expected = { address: 'Erlenweg 12\n12345 Musterhausen', email: 'info@muster-handwerk.example', handelsregister: 'Registergericht: Amtsgericht Beispielburg\nRegisternummer: HRB 4711', ustId: 'DE123456788' };
    expect(all(full)).toEqual(expected);
    // The address of a chamber, a court or an insurer between the operator's data does not end the operator's part.
    const chamber = full.replace('Registereintrag', 'Zuständige Kammer: Handwerkskammer Beispielland, Kammerweg 7, 55555 Kammerstadt\n\nRegistereintrag');
    expect(all(chamber)).toEqual(expected);
    const court = full.replace('Registernummer: HRB 4711', 'Gerichtsweg 2, 54321 Beispielburg\nRegisternummer: HRB 4711');
    expect(all(court)).toMatchObject({ address: expected.address, ustId: expected.ustId });
    expect(value(extractImpressumFields(court).handelsregister)).toMatchObject({ register: 'HRB', number: '4711' });
    // A second place of the operator, named as such, does not end it either.
    const branch = full.replace('Kontakt\n', 'Filiale Nord\nHafenweg 3\n20095 Nordstadt\n\nKontakt\n');
    expect(all(branch)).toEqual(expected);
    // A post box first, the street address in the same town below.
    expect(all('Muster GmbH\nPostfach 12 34\n12340 Musterhausen\nHausanschrift: Erlenweg 12, 12345 Musterhausen').address).toBe('Erlenweg 12, 12345 Musterhausen');
    // The operator's address again in the footer, readable there.
    expect(all('Impressum\nMuster GmbH\nErlenweg 12\nGebäude B\n12345 Musterhausen\n\nPixelwerk GmbH\nKlickweg 1\n11111 Agenturstadt\n\nMuster GmbH · Erlenweg 12 · 12345 Musterhausen').address).toBe('Erlenweg 12 · 12345 Musterhausen');
  });
});

describe('finding 16: a soft hyphen inside a label does not switch the label off', () => {
  const SHY = '­';
  const page = (operator: string, shy: string) =>
    ['Impressum', '', 'Angaben gemäß § 5 DDG', '', operator, '', 'Kontakt', '', 'Telefon: 01234 567890', '', `Aufsichts${shy}behörde`, '', 'Landratsamt Musterkreis', 'Amtsweg 3', '44444 Kreisstadt', '', `Verbraucher${shy}streit${shy}beilegung/Universal${shy}schlichtungs${shy}stelle`, '', 'Zuständig ist das Zentrum für Schlichtung e.V., Straßburger Straße 8, 77694 Kehl am Rhein, mail@schlichter.example, eingetragen unter HRB 1 beim Amtsgericht Kehl, USt-IdNr. DE222222222'].join('\n');

  it('same-line labels with a soft hyphen mark the data as before', () => {
    expect(all(`Aufsichts${SHY}behörde: Landratsamt Musterkreis, Amtsweg 3, 44444 Kreisstadt`).address).toBeNull();
    expect(all(`Daten${SHY}schutz${SHY}beauftragter: dsb@extern.example`).email).toBeNull();
  });

  it('a generator page with soft hyphens in its headings gives the same result as without them', () => {
    for (const operator of ['Max Muster\nErlenweg 12\n12345 Musterhausen\n\nE-Mail: info@muster.example', 'Max Muster\n12345 Musterhausen, Erlenweg 12', 'Max Muster\nErlenweg 12\nGebäude B\n12345 Musterhausen', 'Max Muster\nAm Marktplatz\n12345 Musterhausen']) {
      expect(all(page(operator, SHY)), operator).toEqual(all(page(operator, '')));
      expect(all(page(operator, SHY)).handelsregister, operator).toBeNull();
      expect(all(page(operator, SHY)).ustId, operator).toBeNull();
    }
    expect(all(page('Max Muster\nErlenweg 12\nGebäude B\n12345 Musterhausen', SHY)).address).toBeNull();
  });

  it('the quote is a part of the text without the invisible characters', () => {
    const r = extractImpressumFields(`Muster GmbH\nErlen${SHY}weg 12\n12345 Muster${SHY}hausen\nE-Mail: in​fo@muster.example`);
    expect(quote(r.address)).toBe('Erlenweg 12\n12345 Musterhausen');
    expect(quote(r.email)).toBe('info@muster.example');
  });
});

describe('finding 71: a mailto link whose text is a common word has no known place on the page', () => {
  it('the link of an agency with the text "E-Mail" or "Kontakt" is not the operator\'s e-mail', () => {
    expect(all('Impressum\nE-Mail\nMax Muster\n\nWebdesign: Pixelwerk E-Mail', [{ href: 'mailto:hallo@pixelwerk.example', text: 'E-Mail' }]).email).toBeNull();
    expect(all('Impressum\nMax Muster\n\nKontakt\n\nAgenturpartner Pixelwerk – Kontakt', [{ href: 'mailto:hallo@pixelwerk.example', text: 'Kontakt' }]).email).toBeNull();
  });

  it('controls: a link on the site\'s own domain, and a link whose text is the address', () => {
    expect(all('Impressum\nMax Muster\nE-Mail', [{ href: 'mailto:info@muster.example', text: 'E-Mail' }], ['muster.example']).email).toBe('mailto:info@muster.example');
    expect(all('Impressum\nMax Muster\nINFO@MUSTER.EXAMPLE'.toLowerCase(), [{ href: 'mailto:info@muster.example', text: 'info@muster.example' }]).email).toBe('info@muster.example');
  });
});

describe('finding 72: five digits that are no postcode, and a town that takes the next words', () => {
  it.each([
    'Impressum\nMuster GmbH\nErlenweg 12\n01234 Durchwahl 55',
    'Impressum\nMax Muster\nArtikel 12\n40212 Bohrmaschine',
    'Impressum\nMax Muster\nPreis ab 3, 12500 Euro Gesamtpreis',
    'Impressum\nMax Muster\nHalle 4\n10000 Quadratmeter Fläche',
    'Impressum\nMax Muster\nGebäude 7, 25000 Besucher jährlich',
    'Wir über uns\nStandort Werk 2\n15000 Mitarbeiter weltweit',
  ])('%j is no address', (text) => {
    expect(all(text).address).toBeNull();
  });

  it('the town ends where the sentence or the next label goes on', () => {
    const town = (text: string) => value(extractImpressumFields(text).address)?.town ?? null;
    expect(town('Musterweg 1, 12345 Musterhausen in der Nähe von Beispielstadt')).toBe('Musterhausen');
    expect(town('Musterweg 1, 12345 Musterhausen am Montag geschlossen')).toBe('Musterhausen');
    expect(town('Musterweg 1, 12345 Hof Rechtsform GmbH')).toBe('Hof');
    // Controls: names with small words and two-word names stay whole.
    expect(town('Musterweg 1\n12345 Neustadt an der Aisch')).toBe('Neustadt an der Aisch');
    expect(town('Musterweg 1, 12345 Neu Isenburg Rechtsform GmbH')).toBe('Neu Isenburg');
    expect(town('Musterweg 1, 12345 Bad Musterhausen Inhaber Max')).toBe('Bad Musterhausen');
  });
});

describe('finding 73: the register number, its court and its quote', () => {
  const hr = (text: string) => extractImpressumFields(text).handelsregister;

  it('reads groups of digits as one number and no number that goes on', () => {
    expect(value(hr('Handelsregister: HRB 1 234 567'))).toMatchObject({ number: '1234567' });
    expect(value(hr('HRB 12 345, Amtsgericht Musterstadt'))).toEqual({ register: 'HRB', number: '12345', court: 'Musterstadt' });
    expect(hr('HRB 2024-01').status).toBe('not-found');
    // Controls.
    expect(value(hr('HRB 12.345 Amtsgericht Musterstadt'))).toMatchObject({ number: '12345' });
    expect(value(hr('Amtsgericht Charlottenburg, HRB 123456 B'))).toMatchObject({ number: '123456', court: 'Charlottenburg' });
    expect(value(hr('HRA 12 vom 01.02.2020'))).toMatchObject({ register: 'HRA', number: '12' });
  });

  it('takes no example of the form for the firm\'s entry', () => {
    expect(hr('Kapitalgesellschaften müssen z. B. "HRB 12345" angeben. Wir sind ein Einzelunternehmen.').status).toBe('not-found');
  });

  it('takes no court from the line of another firm, and keeps other lines out of the quote', () => {
    const partner = hr('Muster GmbH, HRB 55\nPartner: Pixelwerk GmbH, Amtsgericht Agenturstadt');
    expect(value(partner)).toEqual({ register: 'HRB', number: '55', court: null });
    expect(quote(partner)).toBe('HRB 55');
    const spread = hr('Registergericht: Amtsgericht Musterstadt\nGeschäftsführer: Max Muster\nUSt-IdNr.: DE123456789\nHRB 5');
    expect(value(spread)).toEqual({ register: 'HRB', number: '5', court: 'Musterstadt' });
    expect(quote(spread)).toBe('HRB 5');
    // Control: court and number with only a register label between them stay one quote.
    expect(quote(hr('Amtsgericht Musterstadt\nRegisternummer:\nHRB 9031'))).toBe('Amtsgericht Musterstadt\nRegisternummer:\nHRB 9031');
  });
});

describe('finding 74: "DE" plus nine digits is a VAT id only under a tax label', () => {
  it.each([
    'Wirtschafts-Identifikationsnummer: DE123456789-00001',
    'W-IdNr.: DE123456789',
    'EORI: DE123456789',
    'Zertifikat Nr. DE 123456789 nach ISO 9001',
    'Art.-Nr. DE-123456789',
    'Hotline DE 800 123 456',
    'Aus dem Ausland: DE 0123 45678',
    'Format der Nummer: DE123456789. Unsere Nummer teilen wir auf Anfrage mit.',
    'USt-IdNr.: auf Anfrage. W-IdNr.: DE123456789',
    'IBAN: DE12 3456 7890 1234 5678 90',
  ])('%j is no VAT id', (text) => {
    expect(extractImpressumFields(text).ustId.status).toBe('not-found');
  });

  it.each([
    ['USt-IdNr.: DE 123.456.789', 'DE123456789'],
    ['Umsatzsteuer-ID\nUmsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:\nDE123456788', 'DE123456788'],
    ['Umsatzsteuer-ID\n\nDE123456788', 'DE123456788'],
    ['USt-IdNr.\tDE123456789', 'DE123456789'],
    ['UStID: DE123456789', 'DE123456789'],
    ['VAT ID: DE 123 456 789', 'DE123456789'],
    ['Telefon: 01234 567890 | Ust.-Id.-Nr.: DE123456789', 'DE123456789'],
    ['Steuernummer: DE 123 456 789', 'DE123456789'],
  ])('control: %j', (text, expected) => {
    expect(value(extractImpressumFields(text).ustId)).toBe(expected);
  });
});
