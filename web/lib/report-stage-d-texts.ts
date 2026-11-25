// Texts of the parts of bericht.html that are stage D (brief: "Revisions table and 'Arbeitsauftrag' button are
// rendered only for the example JSON (behind a flag that is off in production)"): the "Revisionen" and the
// "Arbeitsauftrag" of the help block. Only components/report/stage-d.tsx imports this file, and only the example page
// of the report imports that (built with WC_EXAMPLES=1 only); web/scripts/next.ts fails a production build that
// contains these texts. All of them are the reference's.

export const REVISION_TEXTS = {
  heading: 'Revisionen',
  lead: 'Jede neue Prüfung wird eine Revision',
  columns: ['Rev.', 'Datum', 'Änderung', 'Funde'] as const,
  /** The accessible name of the triangle: "Revision A", "Revision B, noch offen". */
  label: (letter: string) => `Revision ${letter}`,
  labelOpen: (letter: string) => `Revision ${letter}, noch offen`,
  initial: 'Erstprüfung',
  /** "7 Funde" (bold) and ", davon 3 vorrangig". */
  findings: (n: number) => (n === 1 ? '1 Fund' : `${n} Funde`),
  ofWhich: (n: number) => `, davon ${n} vorrangig`,
  open: 'offen',
  afterFix: 'Nach Ihrer Korrektur',
  again: 'Erneut prüfen',
  doneNote: 'So erscheint ein erledigter Fund in der nächsten Revision:',
  fixedIn: (letter: string) => `behoben in Rev. ${letter}`,
} as const;

export const WORK_ORDER_TEXTS = {
  developer: 'Sie haben schon einen Entwickler? Der Arbeitsauftrag enthält jeden Fund mit Feld, Soll-Wert und Anleitung.',
  link: 'Arbeitsauftrag für Ihren Entwickler',
  /** The reference's anchor; the Arbeitsauftrag itself is stage D. */
  href: '#arbeitsauftrag',
} as const;

/** The third action of the head (Fedor, B3 part 2, answer 2: hidden until stage D; session B4 part 2). */
export const DEVELOPER_TEXTS = {
  handOver: 'An Entwickler weitergeben',
} as const;

/**
 * Strings that only these parts have: a production build of web/ must not contain any of them (web/scripts/next.ts).
 * Not the word "Revisionen" alone: the home page names revisions among the features of the report (start.html).
 */
export const STAGE_D_MARKERS = ['Jede neue Prüfung wird eine Revision', 'Arbeitsauftrag', 'Erneut prüfen', 'behoben in Rev.', 'An Entwickler weitergeben'] as const;
