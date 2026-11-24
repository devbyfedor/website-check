import type { Refusal } from './scan-api';
import { SCAN_TEXTS, whenText } from './scan-texts';

// What the form of the home page says when a start is refused (session B2 part 3): one message, tied to the address
// field. Fedor's rules: it reaches the screen reader, the focus stays in the field, and when a start is possible again
// is computed from `Retry-After` and shown in the visitor's own time. Pure functions, tested without a browser.

export type FormProblem = { kind: 'empty' } | Refusal;

/** A problem as the form shows it, with the moment its answer came (ms since 1970). */
export interface ShownProblem {
  problem: FormProblem;
  at: number;
}

const T = SCAN_TEXTS.form;

/** True when the address itself is the problem (the field gets `aria-invalid`); a limit or our error is not. */
export const isAddressProblem = (p: FormProblem): boolean => p.kind === 'empty' || p.kind === 'invalid' || p.kind === 'not-found' || p.kind === 'not-allowed';

/** The message of a problem; `timeZone` only for the example pages. */
export function formMessage({ problem, at }: ShownProblem, timeZone?: string): string {
  const when = (seconds: number | null): string => (seconds === null ? T.later : whenText(at + seconds * 1000, at, timeZone));
  switch (problem.kind) {
    case 'empty':
      return T.empty;
    case 'invalid':
      return T.invalid;
    case 'not-found':
      return T.notFound;
    case 'not-allowed':
      return T.notAllowed[problem.reason ?? 'other'];
    case 'rate':
      return problem.limit === 'day' ? T.rateDay(when(problem.retryAfter)) : problem.limit === 'starts' ? T.rateStarts(when(problem.retryAfter)) : T.rateHour(when(problem.retryAfter));
    case 'busy':
      return T.busy(when(problem.retryAfter));
    case 'ours':
      return T.ours(problem.retryAfter === null ? null : when(problem.retryAfter));
  }
}
