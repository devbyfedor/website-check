// German texts of the real scan screen and the form (sessions B2 part 2 and 3). Every text here is a DRAFT (docs/content-drafts.md,
// sections "Session B2 part 2" and "Session B2 part 3"), except those marked "reference", which are the final texts of
// design/reference/pruefung.html. Texts with numbers are functions; a value of the scanned page is never put into
// a template string here: the view model keeps it apart, so the page shows it as a text node of its own (<bdi>).

/** "a", "a und b", "a, b und c". */
export const listText = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`);

export const SCAN_TEXTS = {
  /** <title> of the scan screen (draft of B2 part 1). */
  title: 'Prüfung läuft, Website-Check DE',
  /** Heading before the API has named the address. */
  headingWithoutHost: 'Ihre Website wird nachgemessen',
  /** Reference: "{domain} wird nachgemessen". */
  headingSuffix: ' wird nachgemessen',

  // The rows of the "Messprotokoll" while they wait for the report: what the scan does, never a result.
  waiting: [
    'Seite aufrufen',
    'Anfragen aufzeichnen',
    'Einwilligungsbanner suchen',
    'Fremde Dienste vor der Einwilligung prüfen',
    'Impressum suchen',
    'Pflichtangaben lesen',
    'Barrierefreiheit prüfen',
    'Verschlüsselung und Sicherheits-Header lesen',
  ] as const,

  // The rows once the report is there.
  pageOpened: 'Seite aufgerufen', // reference
  pageOpenedDetail: 'wie von einem Besucher aus Deutschland', // reference
  requests: (n: number) => (n === 1 ? '1 Anfrage aufgezeichnet' : `${n} Anfragen aufgezeichnet`), // reference for n > 1
  requestsWithoutCount: 'Anfragen aufgezeichnet',
  requestsThirdParty: (n: number) => (n === 0 ? 'keine an fremde Server' : n === 1 ? 'davon 1 an einen fremden Server' : `davon ${n} an fremde Server`), // reference for n > 1
  bannerSeen: 'Einwilligungsbanner erkannt', // reference
  bannerSeenAfter: (seconds: string) => `sichtbar nach ${seconds} Sekunden`, // reference
  bannerNotSeen: 'Kein Einwilligungsbanner erkannt',
  servicesBefore: (n: number) => (n === 1 ? '1 fremder Dienst vor der Einwilligung' : `${n} fremde Dienste vor der Einwilligung`), // reference for n > 1
  /** No service is a finding; requests to third parties (hints, grey zone) may still be there (row 2). */
  servicesNone: 'Keine Funde bei fremden Diensten',
  servicesMore: (n: number) => (n === 1 ? 'und 1 weiterer' : `und ${n} weitere`),
  impressumFound: 'Impressum gefunden', // reference
  impressumAt: 'unter ', // reference: "unter /impressum"
  impressumNotFound: 'Impressum-Link nicht gefunden',
  manualCheck: 'bitte manuell prüfen',
  fieldsRead: 'Pflichtangaben gelesen', // reference
  fieldNames: { address: 'Anschrift', email: 'E-Mail', handelsregister: 'Handelsregister', ustId: 'USt-IdNr.' } as const, // reference: "Anschrift, E-Mail, Handelsregister"
  fieldsNone: 'keine gefunden, bitte manuell prüfen',
  accessibility: 'Barrierefreiheit geprüft', // reference
  accessibilityDetail: 'die 6 häufigsten Fehlertypen', // reference
  security: 'Verschlüsselung und Sicherheits-Header gelesen', // reference

  // The summary under "Fertig. Ihr Bericht ist gezeichnet." (reference: "7 Funde, davon 3 vorrangig. Zu jedem gibt es
  // eine Anleitung für WordPress.").
  findings: (n: number) => (n === 0 ? 'Keine Funde' : n === 1 ? '1 Fund' : `${n} Funde`),
  priorities: (n: number) => `, davon ${n} vorrangig`,
  manual: (n: number) => (n === 1 ? '1 Punkt bitte manuell prüfen.' : `${n} Punkte bitte manuell prüfen.`),
  instructions: (findings: number, system: string) => (findings === 1 ? `Dazu gibt es eine Anleitung für ${system}.` : `Zu jedem gibt es eine Anleitung für ${system}.`),
  // Session B2 part 3: the summary of a report that is not a plain complete check. "morgen" is the text of the brief.
  summaryQuick: 'Schnellprüfung ohne Browser. Die vollständige Prüfung ist morgen wieder möglich.',
  summaryAlmostEmpty: 'Die Seite hat bei unserem Besuch fast keinen Inhalt gezeigt. Deshalb zeigt der Bericht keine Funde, nur Punkte, die Sie bitte manuell prüfen.',
  summaryBlocked: 'Ihre Website hat unsere Prüfung blockiert. Deshalb zeigt der Bericht keine Funde.',
  summaryFailed: 'Ihre Startseite ließ sich nicht prüfen. Deshalb zeigt der Bericht keine Funde.',
  summaryNotAllowed: 'Diese Adresse dürfen wir nicht prüfen. Deshalb zeigt der Bericht keine Funde.',

  // The text description of the drawing (its aria-label).
  drawingWaiting: 'Der Plotter zeichnet die Startseite, die wir prüfen.',
  /** With the report: the marks, each priority with its place (`markAt`), in the order of the priorities. */
  drawingDone: (marks: readonly string[]) =>
    marks.length === 0
      ? 'Der Plotter zeichnet die geprüfte Startseite.'
      : `Der Plotter zeichnet die geprüfte Startseite und markiert rot, wo vorrangige Punkte liegen: ${listText(marks)}.`,
  /** One placed priority: its measured field of the plan ("Feld B2"), or the source code of the page. */
  markAt: (n: number, field: string | null) => (field === null ? `Punkt ${n} im Quelltext` : `Punkt ${n} in Feld ${field}`),
  /** Session B2 part 3: a scan that measured nothing (refused, blocked, failed, ended without a report). */
  drawingUnmeasured: 'Der Plotter zeichnet eine Startseite ohne Markierungen, denn diese Prüfung hat sie nicht gemessen.',

  // The status line (role="status"): a text only at real changes.
  statusQueued: (place: number | null) => (place !== null && place > 0 ? `Ihre Prüfung wartet: Platz ${place} in der Warteschlange.` : 'Ihre Prüfung wartet in der Warteschlange.'),
  statusRunning: 'Die Messung läuft.',
  statusDone: 'Die Messung ist fertig. Der Bericht ist bereit.',
  // Session B2 part 3.
  statusQuick: 'Die Schnellprüfung ist fertig. Der Bericht ist bereit.',
  statusBlocked: 'Die Prüfung ist beendet: Ihre Website hat sie blockiert. Der Bericht ist bereit.',
  statusFailed: 'Die Prüfung ist beendet: Ihre Startseite ließ sich nicht prüfen. Der Bericht ist bereit.',
  statusNotAllowed: 'Die Prüfung ist beendet: Diese Adresse dürfen wir nicht prüfen. Der Bericht ist bereit.',
  statusOffline: 'Keine Verbindung zu unserem Server. Wir versuchen es weiter.',

  // Session B2 part 3: rows of the "Messprotokoll" for what the report did not check, and their variants.
  notChecked: (why: string | null) => (why === null ? 'nicht geprüft' : `nicht geprüft, ${why}`),
  whyQuick: 'Schnellprüfung ohne Browser',
  whyManual: 'bitte manuell prüfen',
  whyNoImpressum: 'kein Impressum geöffnet',
  whyNotAllTypes: 'nicht alle Fehlertypen, bitte manuell prüfen',
  quickPage: 'Quelltext der Seite gelesen',
  quickPageDetail: 'ohne Browser, so wie Ihr Server ihn ausliefert',
  blockedPage: 'Prüfung blockiert',
  /** `quick`: the quick check met the block without a browser (review of B2 part 3). */
  blockedPageDetail: (status: number | null, quick = false) =>
    `Ihre Website hat ${quick ? 'unsere Abfrage' : 'unseren Browser'} nicht durchgelassen${status === null ? '' : ` (Antwort ${status})`}`,
  failedPage: 'Seite nicht geladen',
  failedReason: {
    timeout: 'sie hat nicht rechtzeitig geantwortet',
    unreachable: 'der Server war nicht erreichbar',
    'invalid-address': 'unter dieser Adresse gibt es keine Website',
    'page-limit': 'sie stellt mehr Anfragen oder liefert mehr Daten, als die Prüfung aufzeichnet',
    'not-html': 'unter der Adresse liegt keine Webseite, sondern eine Datei',
    other: 'bei der Prüfung ist ein Fehler aufgetreten',
  } as Readonly<Record<string, string>>,
  failedHttp: (status: number | null) => (status === null ? 'der Server hat mit einem Fehler geantwortet' : `der Server hat mit dem Fehler ${status} geantwortet`),
  notAllowedPage: 'Adresse nicht geprüft',
  notAllowedReason: {
    scheme: 'wir prüfen nur Adressen mit http:// oder https://',
    credentials: 'die Adresse enthält einen Benutzernamen oder ein Passwort',
    port: 'wir prüfen nur die üblichen Ports 80 und 443',
    'host-name': 'die Adresse oder eine Weiterleitung führt zu keinem öffentlichen Server',
    address: 'die Adresse oder eine Weiterleitung führt zu keinem öffentlichen Server',
    unresolved: 'zu dieser Adresse gibt es keinen Server',
    'too-many-redirects': 'die Seite leitet mehr als fünfmal weiter',
    other: 'die Adresse ist für die Prüfung nicht zugelassen',
  } as Readonly<Record<string, string>>,
  servicesManual: (n: number) => (n === 1 ? '1 fremder Dienst, bitte manuell prüfen' : `${n} fremde Dienste, bitte manuell prüfen`),
  impressumSamePage: 'Impressum auf der Startseite',
  impressumSamePageDetail: 'als Abschnitt, ohne eigene Seite',
  impressumPdf: 'als PDF, das wir nicht lesen',
  impressumFailed: 'die Seite ließ sich nicht lesen, bitte manuell prüfen',
  impressumNotOpened: 'nicht geöffnet, bitte manuell prüfen',

  // Session B2 part 3: a scan that ended without a report. The panel of "Bericht öffnen" with its heading, a line and
  // "Neue Prüfung" (the outlined link of the report's header, bericht.html); the status line says the heading.
  headingEnded: ' wurde nicht nachgemessen',
  headingEndedWithoutHost: 'Ihre Website wurde nicht nachgemessen',
  headingUnknown: 'Prüfung nicht gefunden',
  newScan: 'Neue Prüfung', // reference (bericht.html)
  reload: 'Neu laden',
  // The <title> of the scan screen once the scan has ended (review of B2 part 3); "Prüfung läuft" while it waits or runs.
  titleDone: 'Bericht bereit, Website-Check DE',
  titleEnded: 'Prüfung beendet, Website-Check DE',
  ended: {
    cancelled: { title: 'Diese Prüfung wurde abgebrochen.', text: 'Sie wurde aus der Warteschlange genommen, bevor sie begann. Deshalb gibt es keinen Bericht.' },
    other: { title: 'Die Prüfung ist bei uns fehlgeschlagen.', text: 'Deshalb gibt es keinen Bericht. Bitte starten Sie eine neue Prüfung.' },
    unknown: { title: 'Diese Prüfung finden wir nicht.', text: 'Der Link ist unvollständig, oder die Prüfung ist nicht mehr gespeichert.' },
    unreadable: { title: 'Den Bericht können wir gerade nicht anzeigen.', text: 'Die Prüfung ist fertig. Bitte laden Sie diese Seite in einigen Minuten neu.' },
  },
  endedDailyLimit: { title: 'Heute sind alle Prüfungen vergeben.', text: (when: string) => `Diese Prüfung konnte nicht mehr beginnen. Die nächste ist ${when} möglich.` },

  // Session B2 part 3: the form of the home page. Every message is tied to the address field (aria-describedby).
  form: {
    empty: 'Bitte geben Sie die Adresse Ihrer Website ein, zum Beispiel ihre-website.de.',
    invalid: 'Das ist keine Web-Adresse, die wir prüfen können. Bitte geben Sie sie so ein: ihre-website.de.',
    notFound: 'Zu dieser Adresse finden wir keinen Server. Bitte prüfen Sie die Schreibweise.',
    notAllowed: {
      scheme: 'Wir prüfen nur Adressen, die mit http:// oder https:// beginnen.',
      credentials: 'Bitte geben Sie die Adresse ohne Benutzernamen und Passwort ein.',
      port: 'Wir prüfen nur Websites auf den üblichen Ports. Bitte geben Sie die Adresse ohne Portnummer ein.',
      'host-name': 'Diese Adresse ist nicht öffentlich erreichbar. Wir prüfen nur öffentliche Websites.',
      address: 'Diese Adresse führt zu keinem öffentlichen Server. Wir prüfen nur öffentliche Websites.',
      other: 'Diese Adresse können wir nicht prüfen. Wir prüfen nur öffentliche Websites.',
    },
    rateHour: (when: string) => `Sie haben in dieser Stunde so viele Prüfungen gestartet, wie wir einem Besucher erlauben. Die nächste ist ${when} möglich.`,
    rateDay: (when: string) => `Sie haben heute so viele Prüfungen gestartet, wie wir einem Besucher an einem Tag erlauben. Die nächste ist ${when} möglich.`,
    rateStarts: (when: string) => `Sie haben in kurzer Zeit sehr viele Prüfungen gestartet. Die nächste ist ${when} möglich.`,
    busy: (when: string) => `Heute sind alle Prüfungen vergeben. Die nächste ist ${when} möglich.`,
    ours: (when: string | null) => `Bei uns ist gerade ein Fehler aufgetreten. Bitte versuchen Sie es ${when ?? 'in einigen Minuten'} noch einmal.`,
    later: 'später',
  },
} as const;

/**
 * When something is possible again, in the visitor's own time (session B2 part 3, Fedor: from `Retry-After`): the
 * moment rounded up to the next full minute, "ab 14:05 Uhr" today, "morgen ab 01:00 Uhr", or "am 26.11. ab 01:00 Uhr".
 * `timeZone` only for the example pages, which must show the same text when they are built and when they run.
 */
export function whenText(at: number, now: number, timeZone?: string): string {
  const moment = Math.ceil(at / 60_000) * 60_000;
  const zone = timeZone === undefined ? {} : { timeZone };
  const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...zone }).format(moment);
  const day = (ms: number) => new Intl.DateTimeFormat('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit', ...zone }).format(ms);
  if (day(moment) === day(now)) return `ab ${time} Uhr`;
  if (day(moment) === day(now + 24 * 3600 * 1000)) return `morgen ab ${time} Uhr`;
  return `am ${new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric', ...zone }).format(moment)} ab ${time} Uhr`;
}

/** The next 00:00 UTC after `now`: the day's caps of the service start again then (as the API's `Retry-After`). */
export const nextUtcDay = (now: number): number => (Math.floor(now / 86_400_000) + 1) * 86_400_000;

/** Names of the systems as the report page writes them in its tabs (design/reference/bericht.html). */
export const SYSTEM_NAMES: Record<'wordpress' | 'shopify' | 'shopware' | 'wix' | 'jimdo', string> = {
  wordpress: 'WordPress',
  shopify: 'Shopify',
  shopware: 'Shopware',
  wix: 'Wix',
  jimdo: 'Jimdo',
};
