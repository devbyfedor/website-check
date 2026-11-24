// German texts of the real scan screen (session B2 part 2). Every text here is a DRAFT (docs/content-drafts.md,
// section "Session B2 part 2"), except those marked "reference", which are the final texts of
// design/reference/pruefung.html. Texts with numbers are functions; a value of the scanned page is never put into
// a template string here: the view model keeps it apart, so the page shows it as a text node of its own (<bdi>).

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
  /** Until part 3 designs them: the summary of a report that is not a complete check. */
  summaryOther: 'Der Bericht zeigt, was wir prüfen konnten.',

  // The text description of the drawing (its aria-label).
  drawingWaiting: 'Der Plotter zeichnet die Startseite, die wir prüfen.',
  drawingDone: (marks: number) =>
    marks === 0
      ? 'Der Plotter zeichnet die geprüfte Startseite.'
      : marks === 1
        ? 'Der Plotter zeichnet die geprüfte Startseite und markiert einen vorrangigen Punkt rot.'
        : `Der Plotter zeichnet die geprüfte Startseite und markiert ${marks} vorrangige Punkte rot.`,

  // The status line (role="status"): a text only at real changes.
  statusQueued: (place: number | null) => (place !== null && place > 0 ? `Ihre Prüfung wartet: Platz ${place} in der Warteschlange.` : 'Ihre Prüfung wartet in der Warteschlange.'),
  statusRunning: 'Die Messung läuft.',
  statusDone: 'Die Messung ist fertig. Der Bericht ist bereit.',
  /** The one temporary message of part 2 for every answer with an error (part 3 builds the states). */
  statusError: 'Das hat nicht geklappt. Bitte versuchen Sie es später noch einmal.',
  /** The form of the home page: the one temporary message of part 2. */
  formError: 'Das hat nicht geklappt. Bitte prüfen Sie die Adresse und versuchen Sie es noch einmal.',
} as const;

/** Names of the systems as the report page writes them in its tabs (design/reference/bericht.html). */
export const SYSTEM_NAMES: Record<'wordpress' | 'shopify' | 'shopware' | 'wix' | 'jimdo', string> = {
  wordpress: 'WordPress',
  shopify: 'Shopify',
  shopware: 'Shopware',
  wix: 'Wix',
  jimdo: 'Jimdo',
};
