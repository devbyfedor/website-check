// The BFSG decision scheme ("Gilt das BFSG für Sie?", design/reference/bfsg.html): the answers, what each answer opens,
// and every text of the scheme. Pure functions, ported from the reference's script (`renderVals`); the page
// (components/bfsg/) only draws what `bfsgView` returns. Every text is the reference's (final, design/README.md).
//
// The paths: question 1 "Nein" ends at exit 1; "Ja" opens question 2. Question 2 "Ja" ends at exit 2; "Nein" opens
// question 3. Question 3 "Ja" ends at exit 3, "Nein" at exit 4. An answer clears every answer below it; "Neu beginnen"
// clears all three.

export type Answer = '' | 'ja' | 'nein';
export type QuestionNumber = 1 | 2 | 3;

export interface BfsgState {
  q1: Answer;
  q2: Answer;
  q3: Answer;
}

export const BFSG_START: BfsgState = { q1: '', q2: '', q3: '' };

/** How a question card looks: the one to answer next, answered, or not reachable yet (dimmed, its buttons disabled). */
export type CardState = 'cur' | 'done' | 'off';

export interface BfsgView {
  /** Questions 1 to 3. */
  cards: [CardState, CardState, CardState];
  /** Whether the buttons of questions 1 to 3 can be pressed. */
  reachable: [boolean, boolean, boolean];
  /** Exits 1 to 4: the one the answers lead to is highlighted. */
  exits: [boolean, boolean, boolean, boolean];
  /** The arrows from questions 1 to 3 to their exits on the right ("Nein", "Ja", "Ja"). */
  across: [boolean, boolean, boolean];
  /** The arrows down from question 1 to 2 ("Ja"), 2 to 3 ("Nein") and 3 to exit 4 ("Nein"). */
  down: [boolean, boolean, boolean];
  /** The line under the scheme, read by screen readers (aria-live). */
  verdict: string;
}

export const BFSG_VERDICTS = {
  none: 'Noch keine Antwort.',
  notConsumers: 'Ergebnis: Das BFSG gilt für Ihre Website in der Regel nicht.',
  applies: 'Ergebnis: Das BFSG gilt für Sie.',
  exempt: 'Ergebnis: Sie sind als Kleinstunternehmen ausgenommen.',
} as const;

export function bfsgView(state: BfsgState): BfsgView {
  const { q1, q2, q3 } = state;
  const r2 = q1 === 'ja';
  const r3 = r2 && q2 === 'nein';
  const e1 = q1 === 'nein';
  const e2 = r2 && q2 === 'ja';
  const e3 = r3 && q3 === 'ja';
  const e4 = r3 && q3 === 'nein';
  const card = (reach: boolean, answer: Answer): CardState => (!reach ? 'off' : answer ? 'done' : 'cur');
  let verdict: string = BFSG_VERDICTS.none;
  if (e1) verdict = BFSG_VERDICTS.notConsumers;
  if (e2 || e3) verdict = BFSG_VERDICTS.applies;
  if (e4) verdict = BFSG_VERDICTS.exempt;
  return {
    cards: [card(true, q1), card(r2, q2), card(r3, q3)],
    reachable: [true, r2, r3],
    exits: [e1, e2, e3, e4],
    across: [e1, e2, e3],
    down: [r2, r3, e4],
    verdict,
  };
}

/**
 * An answer to one question. It clears the answers below it (as the reference does). A question that cannot be reached
 * yet changes nothing: its buttons are disabled on the page, so this happens only if the page is out of step.
 */
export function answerBfsg(state: BfsgState, question: QuestionNumber, answer: Exclude<Answer, ''>): BfsgState {
  if (!bfsgView(state).reachable[question - 1]) return state;
  if (question === 1) return { q1: answer, q2: '', q3: '' };
  if (question === 2) return { ...state, q2: answer, q3: '' };
  return { ...state, q3: answer };
}

/** "Neu beginnen". */
export function resetBfsg(): BfsgState {
  return { ...BFSG_START };
}

export interface BfsgQuestion {
  n: QuestionNumber;
  title: string;
  text: string;
  /** The answer whose arrow leads to the exit on the right; the other leads down. */
  across: 'Ja' | 'Nein';
  down: 'Ja' | 'Nein';
}

export const BFSG_QUESTIONS: [BfsgQuestion, BfsgQuestion, BfsgQuestion] = [
  {
    n: 1,
    title: 'Verkaufen Sie online an Verbraucher?',
    text: 'Zum Beispiel über einen Online-Shop, Buchungen oder Bestellungen auf Ihrer Website.',
    across: 'Nein',
    down: 'Ja',
  },
  {
    n: 2,
    title: 'Haben Sie 10 oder mehr Beschäftigte?',
    text: 'Gezählt werden alle Beschäftigten, auch in Teilzeit.',
    across: 'Ja',
    down: 'Nein',
  },
  {
    n: 3,
    title: 'Liegen Jahresumsatz und Jahresbilanzsumme beide über 2 Millionen Euro?',
    text: 'Ist einer der beiden Werte niedriger, gelten Sie als Kleinstunternehmen.',
    across: 'Ja',
    down: 'Nein',
  },
];

export const BFSG_EXITS: [{ title: string; text: string }, { title: string; text: string }, { title: string; text: string }, { title: string; text: string }] = [
  { title: 'Gilt in der Regel nicht', text: 'Das BFSG betrifft Angebote an Verbraucher. Barrierefreiheit hilft trotzdem allen Besuchern.' },
  { title: 'Das BFSG gilt für Sie', text: 'Ihr Online-Angebot muss seit dem 28. Juni 2025 barrierefrei sein.' },
  { title: 'Das BFSG gilt für Sie', text: 'Sie liegen über beiden Schwellen für Kleinstunternehmen.' },
  {
    title: 'Sie sind ausgenommen',
    text: 'Als Kleinstunternehmen gelten die Pflichten für Dienstleistungen nicht für Sie. Datenschutz und Impressum betreffen Sie trotzdem.',
  },
];

/** The other texts of the page, in the order of the page. */
export const BFSG_TEXTS = {
  title: 'BFSG-Prüfschema, Website-Check DE', // draft (docs/content-drafts.md, "Session B5 part 1"); the reference: "BFSG-Prüfschema, Bauplan"
  heading: 'Gilt das BFSG für Sie?',
  lead: 'Das Barrierefreiheitsstärkungsgesetz gilt seit dem 28. Juni 2025. Drei Fragen, eine klare Antwort. Wir sagen Ihnen ehrlich, wenn es Sie nicht betrifft.',
  schemeHeading: 'Prüfschema',
  schemeHint: 'Beantworten Sie die Fragen von oben nach unten.',
  question: 'Frage',
  yes: 'Ja',
  no: 'Nein',
  reset: 'Neu beginnen',
  goodToKnow: 'Gut zu wissen',
  notes: [
    'Stellen Sie selbst Produkte her, etwa Geräte mit Bildschirm oder E-Book-Reader, gelten zusätzliche Regeln.',
    'Auch wenn das Gesetz Sie nicht betrifft: Datenschutz und Impressum gelten für jede geschäftliche Website.',
    'Keine Rechtsberatung. Grundlage sind das Barrierefreiheitsstärkungsgesetz und die Leitlinien des Bundesministeriums für Arbeit und Soziales.',
  ],
  checkHeading: 'Wie barrierefrei ist Ihre Seite?',
  checkText: 'Die Schnellprüfung zeigt die sechs häufigsten Fehler und wie Sie sie beheben.',
  checkLink: 'Website prüfen',
} as const;
