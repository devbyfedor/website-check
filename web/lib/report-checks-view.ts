// The list of manual checks and hints under the finding details (session B5 part 2, Fedor's decision): every finding
// of kind `manual` or `hint` that has no card of its own, with a tag, a title and one short text that says what to check.
// Findings of one text id that has a group text (several services, Impressum fields or accessibility checks) are one item
// with their names, at the place of the first. A pure function of a report that passed `validateReport`, tested without a
// browser (web/test/report-checks.test.tsx). Texts: web/lib/report-checks-texts.ts (drafts).

import type { Finding, Report } from '@website-check/scanner/report';
import type { Phrase } from '../components/scan/scan-data';
import { CHECK_NAMES, CHECK_TEXTS, CHECK_TITLES_ONE, CHECKS_TEXTS as T, FIELD_NAMES, type CheckText } from './report-checks-texts';
import { cardedIds } from './report-detail-view';
import { fill, lookup } from './report-texts';

type Part = string | { page: string };

export interface CheckItem {
  /** The id of the first finding of the item (a React key). */
  key: string;
  kind: 'manual' | 'hint';
  tag: string;
  title: Phrase;
  text: Phrase;
  /** "Feld B2" of a single finding that has a place on the plan. */
  field: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The name of a finding inside a group title: a service (a string of the page when the rules data does not know it), an Impressum field, an accessibility check. */
function nameOf(f: Finding, report: Report): Part | null {
  if (f.textId === 'legal-field-not-found') return lookup(FIELD_NAMES, String(f.params.field)) ?? null;
  if (f.textId === 'a11y-manual-check') return lookup(CHECK_NAMES, String(f.params.check)) ?? null;
  const service = str(f.params.service);
  if (service === null) return null;
  const row = f.serviceKey === null ? undefined : report.services.find((s) => s.key === f.serviceKey);
  return row?.known === true ? service : { page: service };
}

/**
 * At most this many names in the title of a group; the rest as "und {n} weitere" (a cut list of 80 unknown services
 * would make one title longer than the page; the Stückliste names every service).
 */
export const GROUP_NAMES_SHOWN = 5;

function shownNames(names: readonly Part[]): Part[] {
  if (names.length <= GROUP_NAMES_SHOWN) return [...names];
  return [...names.slice(0, GROUP_NAMES_SHOWN), T.more(names.length - GROUP_NAMES_SHOWN)];
}

/** Fills `{count}` and `{share}` (our numbers) and puts the names in place of `{names}` or `{service}`, joined by ", ". */
function phrase(template: string, f: Finding, names: readonly Part[]): Phrase | null {
  const values: Record<string, number> = {};
  for (const key of ['count', 'share'] as const) {
    const n = num(f.params[key]);
    if (n !== null) values[key] = n;
  }
  const filled = fill(template, values);
  const parts: Part[] = [];
  for (const p of typeof filled === 'string' ? [filled] : filled) {
    if (typeof p !== 'string') {
      parts.push(p);
      continue;
    }
    const pieces = p.split(/\{(?:names|service)\}/);
    pieces.forEach((piece, i) => {
      if (i > 0) {
        const shown = shownNames(names);
        shown.forEach((n, j) => {
          // "a, b, c, d, e und 75 weitere": the last part is our text, joined by a space.
          const more = j === shown.length - 1 && shown.length < names.length;
          parts.push(...(j === 0 ? [n] : more ? [' ', n] : [', ', n]));
        });
      }
      if (piece !== '') parts.push(piece);
    });
  }
  // A placeholder without its value (an older report without the number or the name): no made-up value.
  if (parts.some((p) => typeof p === 'string' && /\{[a-zA-Z]+\}/.test(p))) return null;
  if (template.match(/\{(?:names|service)\}/) !== null && names.length === 0) return null;
  const merged: Part[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (typeof p === 'string' && typeof prev === 'string') merged[merged.length - 1] = prev + p;
    else merged.push(p);
  }
  return merged.length === 1 && typeof merged[0] === 'string' ? merged[0] : merged;
}

function item(members: readonly Finding[], report: Report): CheckItem {
  const f = members[0] as Finding;
  const kind = f.kind === 'hint' ? 'hint' : 'manual';
  const t: CheckText | undefined = lookup(CHECK_TEXTS, f.textId);
  const names = members.map((m) => nameOf(m, report)).filter((n): n is Part => n !== null);
  const many = members.length > 1 && t?.group !== undefined;
  const one = num(f.params.count) === 1 ? lookup(CHECK_TITLES_ONE, f.textId) : undefined;
  const titleTemplate = many ? t.group!.title : (one ?? t?.title);
  const textTemplate = many ? t.group!.text : t?.text;
  const title = titleTemplate === undefined ? null : phrase(titleTemplate, f, names);
  const text = textTemplate === undefined ? null : phrase(textTemplate, f, names);
  return {
    key: f.id,
    kind,
    tag: kind === 'hint' ? T.tagHint : T.tagManual,
    title: title ?? T.otherTitle,
    text: text ?? (kind === 'hint' ? T.otherHint : T.otherManual),
    field: many || f.field === null ? null : f.field,
  };
}

/** The items of the list, in the order of the findings (manual checks before hints); empty when there is none. */
export function checkItems(report: Report): CheckItem[] {
  // Session C0: every finding with a card (the priorities and the other findings with a risk) is left out.
  const carded = cardedIds(report);
  const open = report.findings.filter((f) => (f.kind === 'manual' || f.kind === 'hint') && !carded.has(f.id));
  const groups = new Map<string, Finding[]>();
  const order: Finding[][] = [];
  for (const f of open) {
    const groupable = lookup(CHECK_TEXTS, f.textId)?.group !== undefined;
    const key = groupable ? `${f.kind}:${f.textId}` : `one:${f.id}`;
    const members = groups.get(key);
    if (members !== undefined) {
      members.push(f);
      continue;
    }
    const fresh = [f];
    groups.set(key, fresh);
    order.push(fresh);
  }
  return order.map((members) => item(members, report));
}
