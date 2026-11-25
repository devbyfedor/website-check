// German texts of the lower part of the report page (session B4 part 1: the Stückliste, the finding details with the
// system tabs, the help block, the title block, and the "Revisionen" of stage D for the example only). Texts marked
// "reference" are the final texts of design/reference/bericht.html (the fix instructions for Shopify, Wix, Jimdo and
// Shopware are drafts by design/README.md); every other text is a DRAFT (docs/content-drafts.md, "Session B4 part 1"),
// or a draft of an earlier session named there. A value of the scanned page is never put into a template string here.

import type { ReportService } from '@website-check/scanner/report';

type ServiceCategory = Exclude<ReportService['category'], 'unknown'>;
type DataLocation = ReportService['dataLocation'];

export const DETAIL_TEXTS = {
  // Stückliste (reference, except the drafts marked).
  servicesHeading: 'Stückliste der fremden Dienste',
  /** Reference: "5 Dienste gefunden"; the singular is a draft. */
  servicesFound: (n: number) => (n === 1 ? '1 Dienst gefunden' : `${n} Dienste gefunden`),
  serviceColumns: ['Pos.', 'Dienst', 'Anbieter', 'Daten gehen an', 'Startet', 'Einwilligung'] as const,
  /** "Startet": every request of the scan happened without consent (the scan never clicks). */
  startsBeforeConsent: 'vor der Einwilligung',
  providerUnknown: 'unbekannt', // draft
  copyList: 'Liste für die Datenschutzerklärung kopieren',
  copyNote: 'Jeder dieser Dienste braucht einen eigenen Abschnitt in Ihrer Datenschutzerklärung.',

  // The finding details (reference).
  happens: 'Was passiert',
  why: 'Warum das wichtig ist',
  inSource: 'Gefunden im Quelltext',
  fixHeading: 'Montageanleitung',
  target: 'Soll',
  actual: 'Ist',
  tablistLabel: 'System wählen',
  detected: 'erkannt',
  /** Draft: a tab of a system our texts have no steps for (and no general steps either). */
  noSystemFix: (system: string) => `Für ${system} haben wir noch keine eigene Anleitung.`,

  // Help block (reference). Its line about the "Arbeitsauftrag" and that button are stage D (report-stage-d-texts.ts).
  helpHeading: 'Sie möchten das nicht selbst umsetzen?',
  helpText: 'Ich behebe die Funde für Sie: Schriften lokal einbinden, die Einwilligung richtig einstellen, Barrieren entfernen. Antwort per E-Mail.',
  helpRequest: 'Hilfe bei der Umsetzung anfragen',

  // Title block (reference).
  stampName: 'Benennung',
  stampNameValue: 'Prüfbericht',
  stampObject: 'Objekt',
  stampDate: 'Datum',
  stampRevision: 'Revision',
  stampSheet: 'Blatt',
  stampSheetValue: '1 von 1',
  stampChecked: 'Geprüft',
  stampCheckedValue: 'automatisch',
} as const;

/**
 * The address of the lead form (stage C). Until then the help button leads there and nothing is collected: the page
 * does not exist yet, and the link carries no value of the report (Fedor, B4 part 1).
 */
export const LEAD_FORM_PATH = '/anfrage';

/**
 * The small line under the name of a service in the Stückliste, by its category: "Schriften", "lädt weitere Skripte",
 * "Statistik" and (for a public CDN) "Skripte" are the reference's words; the others are drafts. The reference's
 * "Produktvideo" names the use on the page, which the scan does not know (docs/report-schema.md, gap 5): "Video".
 */
export const CATEGORY_WORDS: Record<ServiceCategory | 'unknown', string> = {
  fonts: 'Schriften',
  'tag-manager': 'lädt weitere Skripte',
  analytics: 'Statistik',
  'session-recording': 'Aufzeichnung von Besuchen',
  'marketing-automation': 'Marketing',
  advertising: 'Werbung',
  'social-pixel': 'Werbung in sozialen Netzwerken',
  maps: 'Karte',
  video: 'Video',
  'social-embed': 'Beiträge aus sozialen Netzwerken',
  chat: 'Chat',
  reviews: 'Bewertungen',
  booking: 'Terminbuchung',
  'widget-platform': 'Widgets',
  payment: 'Zahlung',
  captcha: 'Schutz vor Bots',
  'accessibility-overlay': 'Werkzeug für Barrierefreiheit',
  translation: 'Übersetzung',
  cdn: 'Skripte',
  platform: 'Dienst Ihres Systems',
  consent: 'Einwilligungstool',
  other: 'Weiteres',
  unknown: 'unbekannter Dienst',
};

/** "Daten gehen an": "Server in den USA möglich" and "weltweites Servernetz" are the reference's; the others drafts. */
export const DATA_LOCATION_TEXTS: Record<DataLocation, string> = {
  'us-possible': 'Server in den USA möglich',
  'worldwide-cdn': 'weltweites Servernetz',
  eu: 'Server in der EU',
  unknown: 'nicht bekannt',
};

/**
 * The tag of "Einwilligung": "fehlt" (red) and "Graubereich" (grey) are the reference's; the others drafts. The
 * reference's "wird eingeholt" (blue) needs a service that waits for a click, which the scan cannot see (gap 3).
 */
export const CONSENT_TAGS: Record<ReportService['consent'], { text: string; tone: 'bad' | 'ok' | 'mid' }> = {
  missing: { text: 'fehlt', tone: 'bad' },
  'grey-zone': { text: 'Graubereich', tone: 'mid' },
  'not-needed': { text: 'nicht nötig', tone: 'ok' },
  'not-reached': { text: 'keine Antwort', tone: 'mid' },
  manual: { text: 'bitte manuell prüfen', tone: 'mid' },
};

/** Numbers one to twelve in words, as the reference writes "zwei Dateien"; from 13 on digits. */
const WORDS = ['null', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
export const countWords = (n: number, one: string, many: string): string => (n === 1 ? `eine ${one}` : `${n <= 12 ? WORDS[n] : String(n)} ${many}`);

/**
 * "0,3 Sekunden" (reference) from milliseconds; "1 Sekunde"; under 50 ms "weniger als 0,1 Sekunden" (draft), never
 * "0 Sekunden".
 */
export function secondsText(ms: number): string {
  if (ms < 50) return 'weniger als 0,1 Sekunden';
  const s = String(Math.round(ms / 100) / 10).replace('.', ',');
  return s === '1' ? '1 Sekunde' : `${s} Sekunden`;
}

/**
 * "Was passiert" of a third-party finding. `precedent` (Google Fonts) is the reference's sentence; the others are
 * drafts that follow it. The last part depends on the banner (extra information only, product rule 1): before it the
 * visitor cannot agree yet; after it, or without a banner seen, the request was made without the visitor's consent,
 * because the scan never clicks.
 */
export const THIRD_PARTY_HAPPENS = {
  files: (count: string, provider: string, seconds: string) => `Ihre Startseite lädt ${count} direkt von ${provider}-Servern, ${seconds} nach dem Aufruf.`,
  requests: (count: string, provider: string, seconds: string) => `Ihre Startseite stellt ${count} an Server von ${provider}, die erste ${seconds} nach dem Aufruf.`,
  beforeBanner: (provider: string) => `${provider} erhält dabei die IP-Adresse jedes Besuchers, bevor dieser zustimmen kann.`,
  noConsent: (provider: string) => `${provider} erhält dabei die IP-Adresse jedes Besuchers, ohne dass dieser zugestimmt hat.`,
} as const;

/** "Warum das wichtig ist" of a third-party finding, by its text id. */
export const THIRD_PARTY_WHY: Record<string, string> = {
  // Reference (Google Fonts, the only service of the class precedent).
  'third-party-precedent': 'Das Landgericht München I hat 2022 einem Besucher dafür Schadensersatz zugesprochen. Die Lösung ist einfach und kostet nichts.',
  // Drafts.
  'third-party-consent-required':
    'Für Dienste zur Statistik, Werbung und ähnliche Zwecke verlangen die deutschen Datenschutzbehörden eine Einwilligung, bevor sie im Browser des Besuchers starten. Ein Einwilligungsbanner allein genügt dafür nicht: Der Dienst darf erst nach der Zustimmung laden.',
  'third-party-usually-consent':
    'Karten, Videos, Chat- und Bewertungsfenster fremder Anbieter brauchen nach Ansicht der deutschen Datenschutzbehörden meist eine Einwilligung, bevor sie laden. Eine gängige Lösung ist ein Platzhalter, der den Dienst erst nach einem Klick lädt.',
};

/** Soll and Ist of a third-party finding: "0 Anfragen an Google", "2 Anfragen, vor dem Banner" (reference). */
export const THIRD_PARTY_TARGET = {
  target: (provider: string) => `0 Anfragen an ${provider}`,
  requests: (n: number) => (n === 1 ? '1 Anfrage' : `${n} Anfragen`),
  beforeBanner: ', vor dem Banner',
  /** Draft: after the banner, or no banner seen; still without consent. */
  noConsent: ', ohne Einwilligung',
} as const;

/**
 * "Was passiert", "Warum das wichtig ist" and the general fix of the other findings that can be among "Drei Dinge":
 * the drafts of docs/content-drafts.md ("Fact and risk" split into the fact and the risk, "Fix" one step per
 * sentence). `{count}`, `{ratio}`, `{expected}`, `{value}` are filled in one pass (`fill`); `one` is the singular.
 */
export interface FindingText {
  happens: string;
  happensOne?: string;
  why: string;
  fix: readonly string[];
}

export const FINDING_TEXTS: Record<string, FindingText> = {
  'a11y-color-contrast': {
    happens: 'An {count} Stellen hebt sich der Text zu wenig vom Hintergrund ab, der schwächste Wert liegt bei {ratio} statt mindestens {expected}.',
    happensOne: 'An einer Stelle hebt sich der Text zu wenig vom Hintergrund ab, der Wert liegt bei {ratio} statt mindestens {expected}.',
    why: 'Menschen mit Sehschwäche und alle, die bei Sonnenlicht aufs Handy schauen, können ihn schwer lesen.',
    fix: [
      'Ändern Sie an diesen Stellen die Text- oder die Hintergrundfarbe, bis der Kontrast mindestens 4,5 : 1 erreicht, bei großer Schrift (ab 24 Pixel, fett ab etwa 19 Pixel) 3 : 1.',
      'Oft steckt eine einzige Farbe aus den Design-Einstellungen dahinter, dann genügt eine Änderung.',
    ],
  },
  'a11y-image-alt': {
    happens: '{count} Bilder haben keinen Alternativtext, also keine kurze Beschreibung im Attribut alt.',
    happensOne: 'Ein Bild hat keinen Alternativtext, also keine kurze Beschreibung im Attribut alt.',
    why: 'Wer einen Screenreader nutzt, hört an diesen Stellen nur den Dateinamen oder gar nichts.',
    fix: [
      'Geben Sie jedem Bild, das etwas Wichtiges zeigt, einen kurzen Alternativtext, der sagt, was darauf zu sehen ist.',
      'Rein dekorative Bilder bekommen ein leeres Attribut alt="", dann überspringt der Screenreader sie.',
    ],
  },
  'a11y-label': {
    happens: '{count} Formularfelder haben keine Beschriftung, die technisch mit dem Feld verbunden ist.',
    happensOne: 'Ein Formularfeld hat keine Beschriftung, die technisch mit dem Feld verbunden ist.',
    why: 'Ein Screenreader kann dann nicht ansagen, was in das Feld gehört, etwa Name oder E-Mail-Adresse.',
    fix: [
      'Verbinden Sie jedes Formularfeld mit einer sichtbaren Beschriftung, im HTML mit <label for="…"> und derselben id am Feld.',
      'Wo kein sichtbarer Text passt, etwa bei einem Suchfeld mit Lupe, hilft ein unsichtbarer Name mit aria-label.',
    ],
  },
  'a11y-link-name': {
    happens: '{count} Links haben keinen Text, den ein Screenreader vorlesen kann, oft sind es Symbole oder Bilder ohne Beschreibung.',
    happensOne: 'Ein Link hat keinen Text, den ein Screenreader vorlesen kann. Meist steckt ein Symbol oder ein Bild ohne Beschreibung dahinter.',
    why: 'Wer die Seite nicht sieht, erfährt nicht, wohin diese Links führen.',
    fix: [
      'Geben Sie jedem Link einen Text, der sein Ziel nennt.',
      'Bei einem Symbol, etwa für Instagram, genügt ein unsichtbarer Name wie aria-label="Instagram" oder ein Alternativtext am Bild im Link.',
    ],
  },
  'a11y-button-name': {
    happens: '{count} Schaltflächen haben keinen Namen, den ein Screenreader vorlesen kann. Häufig sind es Menüsymbole oder die Pfeile eines Bilderkarussells.',
    happensOne: 'Eine Schaltfläche hat keinen Namen, den ein Screenreader vorlesen kann. Oft ist das ein Menüsymbol oder einer der Pfeile eines Bilderkarussells.',
    why: 'Wer die Seite nicht sieht, erfährt nicht, was diese Schaltflächen auslösen.',
    fix: ['Geben Sie jeder Schaltfläche einen sichtbaren Text oder, bei reinen Symbolen, einen unsichtbaren Namen wie aria-label="Menü öffnen".'],
  },
  'a11y-html-has-lang': {
    happens: 'Ihre Seite gibt im Quelltext keine Sprache an, das Attribut lang am html-Element ist nicht gesetzt oder leer.',
    why: 'Screenreader lesen den Text dann in ihrer eingestellten Sprache vor; ist das eine andere Sprache als die Ihrer Seite, klingt die Aussprache oft falsch.',
    fix: ['Tragen Sie die Sprache am Anfang des Quelltexts ein, für eine deutsche Seite: <html lang="de">.', 'In vielen Systemen geschieht das über die Spracheinstellung der Website.'],
  },
  'a11y-html-lang-valid': {
    happens: 'Ihre Seite gibt als Sprache „{value}“ an, das ist kein gültiger Sprachcode.',
    why: 'Screenreader erkennen die Sprache dann nicht sicher und lesen womöglich mit der falschen Aussprache vor.',
    fix: ['Tragen Sie einen gültigen Code ein, für Deutsch lang="de" oder lang="de-DE".', 'Achten Sie auf den Bindestrich: de_DE mit Unterstrich ist kein gültiger Code.'],
  },
  'security-https-missing': {
    happens: 'Ihre Seite wird ohne HTTPS ausgeliefert, also unverschlüsselt.',
    why: 'Wer sich im selben Netz befindet, etwa in einem öffentlichen WLAN, kann Inhalte und Formulareingaben sehen oder verändern; viele Browser zeigen dazu den Hinweis „Nicht sicher“.',
    fix: [
      'Richten Sie ein SSL/TLS-Zertifikat ein.',
      'Viele Hoster bieten kostenlose Zertifikate, etwa von Let’s Encrypt, mit wenigen Klicks an.',
      'Leiten Sie danach alle Aufrufe von http:// dauerhaft auf https:// weiter.',
    ],
  },
  'security-http-no-redirect': {
    happens: 'Unter http:// antwortet Ihr Server mit einer Seite statt mit einer Weiterleitung auf https://.',
    why: 'Wer einem alten Link mit http:// folgt, kann je nach Browser auf der unverschlüsselten Fassung landen.',
    fix: ['Richten Sie für alle Seiten eine dauerhafte Weiterleitung (Statuscode 301) von http:// auf https:// ein.', 'Bei vielen Hostern ist das eine Einstellung im Kundenbereich.'],
  },
  'legal-impressum-no-link': {
    happens:
      'Auf der Startseite haben wir keinen Link gefunden, der zum Impressum führt. Er kann in einem Menü stecken, das sich erst nach einem Klick öffnet, und unsere Prüfung klickt nichts an.',
    why: 'Fehlt der Link wirklich, finden Besucher die Pflichtangaben zum Anbieter nicht, und das kann abgemahnt werden.',
    fix: ['Setzen Sie einen Link mit dem Text „Impressum“ in den Fußbereich jeder Seite, so dass er ohne weiteren Klick sichtbar ist.'],
  },
};

/** The systems of the tabs, in the order of the reference. */
export const FIX_SYSTEMS = ['wordpress', 'shopify', 'wix', 'jimdo', 'shopware'] as const;
export type FixSystem = (typeof FIX_SYSTEMS)[number];
export const FIX_SYSTEM_NAMES: Record<FixSystem, string> = { wordpress: 'WordPress', shopify: 'Shopify', wix: 'Wix', jimdo: 'Jimdo', shopware: 'Shopware' };

/**
 * "Montageanleitung" by system, by the `fixTextId` of a finding. Only Google Fonts has them (reference: WordPress is
 * final, Shopify, Wix, Jimdo and Shopware are drafts by design/README.md). Every other `fix-<service>` text is still
 * missing (docs/content-drafts.md, "Session B4 part 1").
 */
export const FIX_TEXTS: Record<string, Partial<Record<FixSystem, readonly string[]>>> = {
  'fix-google-fonts': {
    wordpress: [
      'Finden Sie heraus, ob Ihr Theme oder ein Plugin die Schrift einbindet. Oft steht es in den Theme-Einstellungen unter „Typografie“.',
      'Binden Sie die Schrift lokal ein, zum Beispiel mit einem Plugin für lokale Google Fonts. Die Dateien liegen danach auf Ihrem eigenen Server.',
      'Starten Sie eine neue Prüfung. Die Anfrage an Google sollte verschwunden sein.',
    ],
    shopify: [
      'Shopify liefert die Schriften Ihres Themes von eigenen Servern. Google Fonts kommen meist aus einer App oder aus eingefügtem Code.',
      'Suchen Sie unter Onlineshop › Themes › Code bearbeiten nach fonts.googleapis.com und entfernen Sie die Einbindung.',
      'Wählen Sie die Schrift in den Theme-Einstellungen aus der Shopify-Schriftbibliothek und starten Sie eine neue Prüfung.',
    ],
    wix: [
      'Wix stellt seine Schriften selbst bereit. Google Fonts laden meist über ein eingebettetes HTML-Element oder eine App.',
      'Entfernen Sie den eingebetteten Code oder die App, die die Schrift lädt.',
      'Laden Sie die gewünschte Schrift als eigene Datei hoch und starten Sie eine neue Prüfung.',
    ],
    jimdo: [
      'Prüfen Sie, ob in den Einstellungen eigener Code im Kopfbereich der Seite eingetragen ist.',
      'Entfernen Sie jede Zeile mit fonts.googleapis.com.',
      'Wählen Sie eine Schrift aus den Design-Einstellungen und starten Sie eine neue Prüfung.',
    ],
    shopware: [
      'In Shopware 6 bindet das Theme die Schriften ein.',
      'Legen Sie die Schriftdateien in den Ordner Ihres Themes und binden Sie sie per @font-face ein, nicht über fonts.googleapis.com.',
      'Kompilieren Sie das Theme neu, leeren Sie den Cache und starten Sie eine neue Prüfung.',
    ],
  },
};
