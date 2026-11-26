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
  /**
   * The reference's name of the tab list; session C0 (Fedor's answer 2): followed by the title of the card, so each tab
   * list of a page has a name of its own ("System wählen: Google Fonts laden vor der Einwilligung"; the colon is a draft).
   */
  tablistLabel: 'System wählen:',
  detected: 'erkannt',
  /** Draft: a tab of a system our texts have no steps for (and no general steps either). */
  noSystemFix: (system: string) => `Für ${system} haben wir noch keine eigene Anleitung.`,
  /**
   * Session C0, drafts: the heading of the cards of the other findings with a risk, after those of "Drei Dinge" (Fedor's
   * answer 2 of B5 part 2), and their count in the form of "5 Dienste gefunden" of the Stückliste.
   */
  moreHeading: 'Weitere Punkte mit Risiko',
  moreCount: (n: number) => (n === 1 ? '1 Punkt' : `${n} Punkte`),

  // Session B4 part 2, drafts: the country of the visit next to a finding about data sent before consent (Fedor,
  // 21.11.2026), a card whose texts are missing, the copying.
  /** The small line under "vor der Einwilligung" of the Stückliste and under "Was passiert" of a card. */
  countryLine: (country: string) => `Land des Aufrufs: ${country}`,
  /** "Was passiert" of a card whose finding has no text yet: the fact that the scan found it. */
  factOnly: 'Die Prüfung hat diesen Punkt gefunden. Eine Beschreibung dazu schreiben wir noch.',
  /** The box of the "Montageanleitung" of a finding without a fix text yet (the texts are a session after B4). */
  noFix: 'Für diesen Punkt haben wir noch keine Anleitung.',
  /** The label of the copy button after copying (reference). */
  copiedList: 'Liste kopiert',
  copyListFailed: 'Die Liste konnte nicht kopiert werden.', // draft
  /** The copied list (reference: "Externe Dienste auf roesterei-muster.de (Prüfung vom 19.11.2026):"). */
  copyHeading: (domain: string, date: string) => `Externe Dienste auf ${domain} (Prüfung vom ${date}):`,
  /** Draft: the last line of a cut list. */
  copyMore: (n: number) => (n === 1 ? '… und 1 weiterer Dienst, den der Bericht nicht einzeln aufführt.' : `… und ${n} weitere Dienste, die der Bericht nicht einzeln aufführt.`),

  // Help block (reference). Its line about the "Arbeitsauftrag" and that button are stage D (report-stage-d-texts.ts).
  helpHeading: 'Sie möchten das nicht selbst umsetzen?',
  /** Reference: "Ich behebe die Funde für Sie: Schriften lokal einbinden, die Einwilligung richtig einstellen, Barrieren entfernen. Antwort per E-Mail." */
  helpText: (tasks: readonly string[]) => (tasks.length === 0 ? 'Ich behebe die Funde für Sie. Antwort per E-Mail.' : `Ich behebe die Funde für Sie: ${tasks.join(', ')}. Antwort per E-Mail.`),
  /** Drafts: a report without priorities (nothing to fix first, an almost empty page). */
  helpHeadingNone: 'Sie möchten Ihre Website genauer prüfen lassen?',
  helpTextNone: 'Unsere automatische Prüfung sieht nur die Startseite und das Impressum. Ich sehe mir Ihre Website gern genauer an. Antwort per E-Mail.',
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
 * What the help block offers to do, by the priorities of the report, in their order (session B4 part 2): "Schriften
 * lokal einbinden", "die Einwilligung richtig einstellen" and "Barrieren entfernen" are the reference's (its priorities
 * are Google Fonts, Google Analytics and the contrast); the others are drafts. A priority of another kind adds nothing.
 */
export const HELP_TASKS = {
  fonts: 'Schriften lokal einbinden',
  consent: 'die Einwilligung richtig einstellen',
  barriers: 'Barrieren entfernen',
  https: 'HTTPS einrichten',
  headers: 'Sicherheits-Header setzen',
  impressum: 'den Link zum Impressum setzen',
} as const;

/** The head of the report (B4 part 2): "Link kopiert" is Fedor's (B3 part 2, answer 2); the failure is a draft. */
export const HEAD_ACTION_TEXTS = {
  copiedLink: 'Link kopiert',
  copyLinkFailed: 'Der Link konnte nicht kopiert werden.',
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
  /** One request: no "die erste" (review of B4 part 1). */
  request: (provider: string, seconds: string) => `Ihre Startseite stellt eine Anfrage an Server von ${provider}, ${seconds} nach dem Aufruf.`,
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
  /** Draft: the first request before the banner, not every one (or the report keeps fewer requests than it counts). */
  firstBeforeBanner: ', die erste vor dem Banner',
  /** Draft: after the banner, or no banner seen; still without consent. */
  noConsent: ', ohne Einwilligung',
} as const;

/**
 * Session texts-fix (drafts, docs/content-drafts.md, "Session texts-fix"): the general steps of the "Montageanleitung"
 * of a third-party finding by its class, for a known service without steps of its own.
 */
const FONTS_GENERAL = [
  'Laden Sie die Schriften, die Ihre Seite nutzt, bei Google Fonts herunter und legen Sie die Dateien auf Ihren eigenen Server.',
  'Binden Sie sie mit @font-face aus diesen Dateien ein und entfernen Sie jeden Verweis auf fonts.googleapis.com und fonts.gstatic.com, auch in Theme, Plugins und eingefügtem Code.',
  'Starten Sie eine neue Prüfung. Die Anfrage an Google sollte verschwunden sein.',
] as const;

export const THIRD_PARTY_FIX: Record<string, readonly string[]> = {
  'third-party-precedent': FONTS_GENERAL,
  'third-party-consent-required': [
    'Laden Sie den Dienst erst, nachdem der Besucher im Einwilligungsbanner zugestimmt hat. Vorher darf sein Skript nicht starten, auch nicht über einen Tag Manager.',
    'Das übernimmt ein Einwilligungstool: Sie tragen den Dienst dort ein, und das Tool blockiert ihn laut Anbieter, bis der Besucher zustimmt. Beispiele sind CCM19, Cookiebot, Usercentrics und das quelloffene, kostenlose Klaro!.',
    'Starten Sie danach eine neue Prüfung. Vor der Zustimmung sollte keine Anfrage an den Anbieter mehr zu sehen sein.',
  ],
  'third-party-usually-consent': [
    'Ersetzen Sie den eingebetteten Inhalt zunächst durch einen Platzhalter, etwa einen kurzen Hinweis oder ein Bild von Ihrem eigenen Server. Der Inhalt des Anbieters lädt erst, wenn der Besucher darauf klickt oder im Einwilligungsbanner zustimmt.',
    'Viele Einwilligungstools bringen solche Platzhalter mit. Ohne Werkzeug genügt oft ein einfacher Link, etwa zur Anfahrt auf der Karte des Anbieters oder zum Video auf seiner Seite.',
    'Starten Sie danach eine neue Prüfung. Vor dem Klick oder der Zustimmung sollte keine Anfrage an den Anbieter mehr zu sehen sein.',
  ],
};

/** Consent Mode of Google: the basic implementation loads nothing before consent, the advanced one does. */
const CONSENT_MODE =
  'Wenn Sie den Einwilligungsmodus von Google (Consent Mode) nutzen, wählen Sie die einfache Umsetzung („basic“). In der erweiterten Umsetzung („advanced“) laden die Google-Tags schon beim Aufruf und senden ohne Zustimmung Daten ohne Cookies an Google.';

/**
 * Session texts-fix: the general steps of the five services with a risk found most often in the saved reports, by
 * their `fixTextId`: without tabs, and in a system tab without confirmed steps of its own. Drafts.
 */
export const SERVICE_FIX: Record<string, readonly string[]> = {
  'fix-google-fonts': FONTS_GENERAL,
  'fix-google-tag-manager': [
    'Laden Sie den Google Tag Manager erst nach der Zustimmung im Einwilligungsbanner. Schon das Laden seines Skripts ist eine Anfrage an Google, gleich welche Tags darin stehen.',
    'Tragen Sie ihn dazu in Ihrem Einwilligungstool als eigenen Dienst ein, so dass das Tool ihn bis zur Zustimmung blockiert. Wird das Einwilligungsbanner selbst über den Tag Manager eingebunden, binden Sie es stattdessen direkt in die Seite ein.',
    'Starten Sie danach eine neue Prüfung. Vor der Zustimmung sollte keine Anfrage an googletagmanager.com mehr zu sehen sein.',
  ],
  'fix-google-analytics': [
    'Laden Sie Google Analytics erst nach der Zustimmung im Einwilligungsbanner: Ihr Einwilligungstool blockiert den Dienst, bis der Besucher zustimmt.',
    CONSENT_MODE,
    'Starten Sie danach eine neue Prüfung. Vor der Zustimmung sollte keine Anfrage an Google Analytics mehr zu sehen sein.',
  ],
  'fix-google-ads': [
    'Laden Sie die Werbe-Tags von Google, etwa das Conversion-Tracking und Remarketing von Google Ads oder die Anzeigen von AdSense, erst nach der Zustimmung im Einwilligungsbanner: Ihr Einwilligungstool blockiert sie, bis der Besucher zustimmt.',
    CONSENT_MODE,
    'Starten Sie danach eine neue Prüfung. Vor der Zustimmung sollte keine Anfrage an doubleclick.net, googlesyndication.com oder googleadservices.com mehr zu sehen sein.',
  ],
  'fix-youtube-nocookie': [
    'Laden Sie das Video erst nach einem Klick: An seiner Stelle steht zuerst ein Vorschaubild von Ihrem eigenen Server mit einem kurzen Hinweis. Der Player lädt erst, wenn der Besucher klickt oder im Einwilligungsbanner zustimmt.',
    'Der erweiterte Datenschutzmodus allein genügt dafür nicht: Auch mit ihm lädt der Player schon beim Aufruf Ihrer Seite von youtube-nocookie.com, wie diese Prüfung zeigt.',
    'Viele Einwilligungstools bringen solche Platzhalter mit. Ohne Werkzeug genügt ein Vorschaubild von Ihrem Server mit einem Link zum Video auf YouTube. Starten Sie danach eine neue Prüfung.',
  ],
};

/** The names of the five headers, as the steps of the card "Sicherheits-Header" name them. */
export const HEADER_NAMES: Record<string, string> = {
  hsts: 'Strict-Transport-Security',
  csp: 'Content-Security-Policy',
  xcto: 'X-Content-Type-Options',
  'referrer-policy': 'Referrer-Policy',
  'permissions-policy': 'Permissions-Policy',
};

/**
 * Session texts-fix: the step of the card "Sicherheits-Header" for each header that does not count, by the text id of
 * the header (`report.security.headers[].textId`): the title and the fix of the drafts of sessions A3 and fix-a6
 * (docs/content-drafts.md, "Security"). `{header}` is the name of the header (HEADER_NAMES). Drafts.
 */
export const HEADER_STEPS: Record<string, string> = {
  'security-header-hsts-missing':
    'Strict-Transport-Security nicht gesetzt. Senden Sie den Header mit jeder HTTPS-Antwort, zum Beispiel Strict-Transport-Security: max-age=31536000 (ein Jahr); über http:// gesendet, beachtet ihn der Browser nicht. Wenn Sie unsicher sind, beginnen Sie mit einer kurzen Laufzeit, etwa max-age=86400 (ein Tag), und erhöhen Sie sie später. Den Zusatz includeSubDomains setzen Sie nur, wenn alle Subdomains HTTPS haben.',
  'security-header-hsts-invalid': 'Strict-Transport-Security ohne Wirkung. Senden Sie den Header in der HTTPS-Antwort mit einer Laufzeit in Sekunden, zum Beispiel max-age=31536000 für ein Jahr.',
  'security-header-hsts-no-max-age': 'Strict-Transport-Security ohne gültige Laufzeit. Ergänzen Sie eine Laufzeit in Sekunden in der Form max-age=Zahl, zum Beispiel Strict-Transport-Security: max-age=31536000 für ein Jahr.',
  'security-header-hsts-duplicate': 'Strict-Transport-Security mit doppelter Angabe. Nennen Sie jede Angabe nur einmal, zum Beispiel Strict-Transport-Security: max-age=31536000; includeSubDomains.',
  'security-header-csp-missing':
    'Content-Security-Policy nicht gesetzt. Legen Sie eine Richtlinie an, die nur die Quellen erlaubt, die Ihre Seite wirklich nutzt. Testen Sie sie zuerst als Content-Security-Policy-Report-Only, dann sehen Sie, was blockiert würde, ohne dass etwas kaputtgeht.',
  'security-header-csp-invalid':
    'Content-Security-Policy mit Fehlern. Prüfen Sie die Schreibweise, zum Beispiel script-src statt script-scr, und trennen Sie die Anweisungen mit Semikolon. Die Konsole in den Entwicklerwerkzeugen des Browsers zeigt, was er nicht versteht.',
  'security-header-csp-report-only':
    'Content-Security-Policy nur im Testmodus. Wenn die Meldungen keine Probleme mehr zeigen, senden Sie dieselbe Richtlinie als Content-Security-Policy. Den Testmodus können Sie für spätere Änderungen daneben behalten.',
  'security-header-csp-manual': 'Content-Security-Policy: bitte manuell prüfen. Suchen Sie im Quelltext der Startseite nach <meta http-equiv="Content-Security-Policy".',
  'security-header-csp-meta': 'Content-Security-Policy im Quelltext statt im Header. Wenn Ihr Hoster es erlaubt, senden Sie die Richtlinie als HTTP-Header. Sonst setzen Sie das meta-Element möglichst weit oben in den head, denn es gilt erst ab seiner Stelle.',
  'security-header-xcto-missing': 'X-Content-Type-Options nicht gesetzt. Senden Sie den Header X-Content-Type-Options: nosniff. Er stört nichts, solange Ihr Server Skripte und Stylesheets mit dem richtigen Typ ausliefert.',
  'security-header-xcto-invalid': 'X-Content-Type-Options mit falschem Wert. Setzen Sie den Wert genau auf nosniff: X-Content-Type-Options: nosniff.',
  'security-header-referrer-policy-missing':
    'Referrer-Policy nicht gesetzt. Setzen Sie den Header ausdrücklich, zum Beispiel Referrer-Policy: strict-origin-when-cross-origin. Dann hängt das Verhalten nicht von der Voreinstellung des einzelnen Browsers ab.',
  'security-header-referrer-policy-invalid':
    'Referrer-Policy mit unbekanntem Wert. Verwenden Sie einen der festgelegten Werte, zum Beispiel strict-origin-when-cross-origin oder no-referrer. Im Header dürfen mehrere Werte mit Komma getrennt stehen; der Browser nimmt den letzten, den er kennt.',
  'security-header-referrer-policy-manual': 'Referrer-Policy: bitte manuell prüfen. Suchen Sie im Quelltext der Startseite nach <meta name="referrer".',
  'security-header-referrer-policy-meta': 'Referrer-Policy im Quelltext statt im Header. Wenn Sie später auch den Header setzen, verwenden Sie denselben Wert, damit sich beide Angaben nicht widersprechen.',
  'security-header-referrer-policy-weak':
    'Referrer-Policy schwächer als die Voreinstellung. Setzen Sie Referrer-Policy: strict-origin-when-cross-origin oder einen strengeren Wert wie same-origin oder no-referrer. Prüfen Sie auch ein meta-Element name="referrer" im Quelltext: Es gilt nach dem Header.',
  'security-header-permissions-policy-missing':
    'Permissions-Policy nicht gesetzt. Senden Sie den Header und schalten Sie ab, was Ihre Seite nicht nutzt, zum Beispiel Permissions-Policy: camera=(), microphone=(), geolocation=().',
  'security-header-permissions-policy-invalid':
    'Permissions-Policy fehlerhaft geschrieben. Schreiben Sie jede Funktion in der Form Name=Wert, zum Beispiel camera=() für „nirgends erlaubt“, geolocation=(self) für „nur Ihre eigene Seite“ oder fullscreen=* für „überall erlaubt“, und trennen Sie die Einträge mit Komma.',
  'security-header-permissions-policy-legacy': "Nur der veraltete Header Feature-Policy. Senden Sie stattdessen Permissions-Policy. Die Schreibweise ist neu: Aus camera 'none' wird camera=().",
  'security-header-permissions-policy-open':
    'Permissions-Policy erlaubt alles. Schalten Sie ab, was Ihre Seite nicht nutzt, zum Beispiel Permissions-Policy: camera=(), microphone=(), geolocation=(). Erlauben Sie eine Funktion nur dort, wo sie gebraucht wird, etwa geolocation=(self).',
  'security-header-too-long': '{header}: Wert zu lang für die Prüfung, bitte manuell prüfen, ob er so gewollt ist. Übliche Werte dieses Headers sind wenige Zeilen lang.',
};

/** Session texts-fix: the first and the last step of the card "Sicherheits-Header" around the steps of the headers. */
export const HEADER_STEPS_FRAME = {
  first:
    'Die Header setzen Sie in der Konfiguration Ihres Servers oder im Kundenbereich Ihres Hosters. Haben Sie darauf keinen Zugriff, etwa bei einem Baukastensystem, fragen Sie Ihren Anbieter, welche Header er sendet.',
  last: 'Starten Sie danach eine neue Prüfung.',
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
  // Session texts-fix (draft): the card of the security headers. Its steps are built from the headers of the report
  // (HEADER_STEPS between the two of HEADER_STEPS_FRAME); `fix` is used only when the report lists none.
  'security-headers': {
    happens: 'Von den {total} gängigen Sicherheits-Headern zählen wir bei Ihrer Startseite {present} als gesetzt. Welche fehlen oder nicht wirken, steht in der Montageanleitung.',
    why: 'Diese Header sind Anweisungen Ihres Servers an den Browser. Sie erschweren bekannte Angriffe, etwa das Einschleusen fremder Skripte oder das Umlenken auf eine unverschlüsselte Verbindung. Fehlen sie, entfällt dieser zusätzliche Schutz; Ihre Seite funktioniert trotzdem.',
    fix: [HEADER_STEPS_FRAME.first, HEADER_STEPS_FRAME.last],
  },
};

/** The systems of the tabs, in the order of the reference. */
export const FIX_SYSTEMS = ['wordpress', 'shopify', 'wix', 'jimdo', 'shopware'] as const;
export type FixSystem = (typeof FIX_SYSTEMS)[number];
export const FIX_SYSTEM_NAMES: Record<FixSystem, string> = { wordpress: 'WordPress', shopify: 'Shopify', wix: 'Wix', jimdo: 'Jimdo', shopware: 'Shopware' };

/** Session texts-fix: parts that several steps by system share. */
const NEW_SCAN = 'Starten Sie eine neue Prüfung.';
const SHOPIFY_CONSENT_APP = 'Eine Cookie-Banner-App kann Tracking-Skripte bis zur Zustimmung blockieren, zum Beispiel Consentico (laut App-Seite mit kostenlosem Tarif).';
const wixCustomCode = (what: string) =>
  `Eigener Code gilt bei Wix ohne weitere Einstellung als notwendig und lädt laut Wix vor der Einwilligung. Steht ${what} als eigener Code auf der Seite, entfernen Sie ihn oder ordnen Sie ihn in seinen Einstellungen einer anderen Kategorie zu (in der englischen Hilfe von Wix: „Custom Code“).`;

/**
 * "Montageanleitung" by system, by the `fixTextId` of a finding. The WordPress steps of Google Fonts are the reference's
 * (final). Session texts-fix: steps by system only for the five services with a risk found most often, and only steps
 * the official documentation of the system or plugin confirms and a second helper could not refute; each step names its
 * source next to it in docs/content-drafts.md (a unit test checks it). The reference's drafts for Shopify, Wix, Jimdo and
 * Shopware are replaced by checked steps or left out (Jimdo). A system without confirmed steps shows the general steps
 * (SERVICE_FIX). Drafts.
 */
export const FIX_TEXTS: Record<string, Partial<Record<FixSystem, readonly string[]>>> = {
  'fix-google-fonts': {
    // Reference, final; session B5 part 2 (Fedor: checked by the rules of the session of the fix texts): the first step in
    // the narrower wording the second check confirmed, each step with its source in docs/content-drafts.md.
    wordpress: [
      'Finden Sie heraus, ob Ihr Theme oder ein Plugin die Schrift einbindet. Bei Block-Themes stehen die Schriften in den Stilen des Website-Editors unter „Typografie“.',
      'Binden Sie die Schrift lokal ein, zum Beispiel mit einem Plugin für lokale Google Fonts. Die Dateien liegen danach auf Ihrem eigenen Server.',
      'Starten Sie eine neue Prüfung. Die Anfrage an Google sollte verschwunden sein.',
    ],
    // Session texts-fix: checked against the documentation; they replace the drafts of the reference (Jimdo has none).
    shopify: [
      'Schriften aus der Schriftbibliothek von Shopify liefert Shopify über sein eigenes CDN aus, nicht von Google. Eine Anfrage an fonts.googleapis.com stammt aus Code, der Google Fonts zusätzlich einbindet, etwa im Theme.',
      'Entfernen Sie diese Einbindung im Code-Editor Ihres Themes.',
      'Wählen Sie die Schrift stattdessen in den Einstellungen Ihres Themes aus der Schriftbibliothek von Shopify. Diese nutzen laut Shopify alle kostenlosen Themes; bei anderen Themes bestimmt der Theme-Entwickler die Auswahl.',
      NEW_SCAN,
    ],
    wix: [
      'Laut Wix werden Google Fonts bei Wix lokal gehostet. Schriften, die über benutzerdefiniertes Einbetten, ein benutzerdefiniertes Element oder ein iframe eingefügt sind, können dagegen von Google stammen.',
      'Entfernen Sie ein solches Element: Wählen Sie es im Editor aus und drücken Sie die Entfernen-Taste.',
      'Laden Sie die gewünschte Schrift stattdessen als eigene Datei hoch: Textelement auswählen, auf „Text bearbeiten“ klicken, im Menü „Schriftarten“ auf „Schriftarten hochladen“ und danach auf „Fertig“.',
      NEW_SCAN,
    ],
    shopware: [
      'In Shopware 6 legen Sie die Schriftdateien als Asset in Ihr Theme, in den Ordner, den die theme.json unter „asset“ nennt.',
      'Binden Sie die Schrift im Stylesheet des Themes mit @font-face aus diesen Dateien ein und entfernen Sie den Verweis auf fonts.googleapis.com.',
      'Kompilieren Sie das Theme mit bin/console theme:compile neu und starten Sie eine neue Prüfung.',
    ],
  },
  'fix-google-analytics': {
    wordpress: [
      'Entfernen Sie Google-Analytics-Code, der schon fest im Theme oder in einem anderen Plugin steht.',
      'Binden Sie Google Analytics über ein Einwilligungs-Plugin ein, das Skripte bis zur Zustimmung blockiert, zum Beispiel Complianz (die kostenlose Version enthält laut Plugin-Seite das Blockieren von Skripten) oder Cookiebot (laut Plugin-Seite kostenlos für eine Domain mit bis zu 50 Unterseiten).',
      'Bei Complianz Premium lassen Sie Google-Tags vor der Einwilligung blockieren (in der englischen Anleitung die Frage „Do you want to block all Google Tags before consent?“, Antwort „Yes“). Mit der Voreinstellung „No“ laden die Google-Tags laut Complianz schon beim Aufruf der Seite.',
      NEW_SCAN,
    ],
    shopify: ['Prüfen Sie im Code-Editor Ihres Themes, ob Google Analytics dort fest eingetragen ist, und entfernen Sie es.', SHOPIFY_CONSENT_APP, NEW_SCAN],
    wix: [
      'Verbinden Sie Google Analytics über „Marketing-Integrationen“ in der Website-Verwaltung (unter „Google-Tag“ auf „Verknüpfen“).',
      'Schalten Sie unter „Datenschutz & Cookies“ das Cookie-Hinweisbanner ein (Schieberegler „Banner anzeigen“). Laut Wix schaltet es nicht unbedingt erforderliche Cookies und Skripte ab, bis der Besucher zustimmt; Google Analytics zählt Wix zu den Analyse-Cookies. Die Basisversion des Banners ist kostenlos.',
      wixCustomCode('Google Analytics zusätzlich'),
      NEW_SCAN,
    ],
  },
  'fix-google-tag-manager': {
    wordpress: [
      'Prüfen Sie, wo der Google Tag Manager eingebunden ist (Theme, Plugin oder eigenes Snippet), und entfernen Sie die übrigen Einbindungen, bevor Sie ihn im Einwilligungs-Plugin einrichten.',
      'Bei Complianz setzen Sie im Snippet des Tag Managers type="text/plain" und data-category="statistics": Laut Complianz blockiert das den Tag Manager vor der Einwilligung und gibt ihn danach frei.',
      'Bei Real Cookie Banner wählen Sie die Vorlage „Google Tag Manager“ und lassen für den Dienst einen Inhaltsblocker anlegen; die Unterstützung für den Tag Manager gehört laut Plugin-Seite zur Pro-Version.',
      NEW_SCAN,
    ],
    shopify: [
      'Entfernen Sie einen fest eingetragenen Tag Manager aus dem Code-Editor Ihres Themes.',
      'Binden Sie ihn stattdessen als eigenes Pixel ein (in der englischen Hilfe von Shopify: „Customer events“) und verlangen Sie dafür die Berechtigung des Besuchers („Permission“: „Required“). In Märkten mit Einwilligungspflicht wie dem EWR läuft ein solches Pixel laut Shopify erst, wenn der Besucher die verlangten Berechtigungen erteilt hat.',
      `Alternativ: ${SHOPIFY_CONSENT_APP}`,
      NEW_SCAN,
    ],
    wix: [
      wixCustomCode('der Tag Manager'),
      'Ist er über die Marketing-Integrationen verbunden, sammelt er laut Wix erst nach der Einwilligung Daten. Ob er vorher schon lädt, sagt Wix nicht. Starten Sie eine neue Prüfung: Sie zeigt, ob vor der Zustimmung noch eine Anfrage an googletagmanager.com geht.',
    ],
  },
  'fix-google-ads': {
    shopify: ['Prüfen Sie im Code-Editor Ihres Themes, ob Code von Google Ads oder AdSense dort fest eingetragen ist.', SHOPIFY_CONSENT_APP, NEW_SCAN],
    wix: [
      wixCustomCode('Code von Google Ads oder AdSense'),
      'Ist Google Ads über die Marketing-Integrationen verbunden, sammelt es laut Wix erst nach der Einwilligung Daten. Ob es vorher schon lädt, sagt Wix nicht. Starten Sie eine neue Prüfung: Sie zeigt, ob vor der Zustimmung noch eine Anfrage an Google geht.',
    ],
  },
  'fix-youtube-nocookie': {
    wordpress: [
      'Das quelloffene Plugin Embed Privacy ersetzt eingebettete Inhalte wie YouTube-Videos durch einen Platzhalter; laut Plugin-Seite lädt es sie erst, wenn der Besucher das Laden externer Inhalte erlaubt.',
      'Ein Einwilligungs-Plugin mit Inhaltsblocker tut dasselbe, zum Beispiel Complianz, das laut Plugin-Seite iFrames wie YouTube blockiert.',
      NEW_SCAN,
    ],
    wix: [
      'Das YouTube-Element ist laut Wix nicht in die Cookie-Banner-Lösung von Wix eingebunden; das Banner allein hält es also nicht auf.',
      'Entfernen Sie das YouTube-Element (im Editor auswählen und die Entfernen-Taste drücken). Als Alternative nennt Wix Wix Video; laut Wix werden dabei keine Besucherdaten an Google in den USA übertragen.',
      NEW_SCAN,
    ],
  },
};
