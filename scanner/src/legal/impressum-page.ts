import type { PageSnapshot } from '../capture/types.ts';
import { stripInvisible } from './links.ts';

/**
 * Is the page behind the Impressum link really an Impressum (session fix-a3, review finding 6)?
 *
 * A server that answers a deleted page with HTTP 200 and "Seite nicht gefunden", or sends the visitor to
 * the homepage, the contact page or a login, gives a page with text. Its footer often holds an address,
 * an e-mail and a register number, so the templates would "find" fields on a page that is no Impressum.
 * The page counts only with a positive sign, and never when it says that it is an error page or when it
 * is the homepage again. Unsure means "bitte manuell prüfen": the state is `failed`, not a finding.
 */

export type ImpressumPageVerdict = { impressum: true } | { impressum: false; reason: 'error-page' | 'homepage' | 'no-sign'; message: string };

const IMPRESSUM_WORD = /(?:^|[^\p{L}])(?:impressum|imprint|anbieterkennzeichnung|anbieterkennung|legal notice|legal disclosure|site notice)(?![\p{L}])/giu;

/** Sentences of a German legal notice that no menu and no footer link carries. */
const NOTICE_PHRASE =
  /angaben gem(?:ä|ae)(?:ß|ss)|angaben gem\.|§\s*5\s*(?:tmg|ddg|telemediengesetz|digitale-dienste-gesetz)|(?:inhaltlich\s+)?verantwortlich(?:e[rn]?)?\s+(?:für\s+den\s+inhalt|i\.?\s?s\.?\s?d\.?|im\s+sinne|nach\s+§|gem(?:äß|\.)\s+§)|haftung\s+für\s+(?:inhalte|links)|diensteanbieter|information pursuant to/iu;

const ERROR_TITLE =
  /(?:^|[^\p{L}\p{N}])(?:404|nicht gefunden|not found|seite existiert nicht|fehlerseite|seite nicht (?:mehr )?(?:vorhanden|verfügbar)|page (?:does not|doesn['’]t) exist)(?![\p{L}\p{N}])/iu;
/** A short line (a heading) that says the page does not exist. */
const ERROR_LINE =
  /^(?:(?:fehler|error|http)\s*:?\s*)?404(?![\p{L}\p{N}])|(?:seite|page|inhalt|url|adresse|dokument)\b.{0,40}(?:nicht gefunden|not found|existiert (?:leider )?nicht|nicht (?:mehr )?(?:vorhanden|verfügbar)|konnte nicht gefunden werden|does not exist|doesn['’]t exist)|^(?:nicht gefunden|not found)\b/iu;

const squash = (text: string): string => stripInvisible(text).replace(/\s+/gu, ' ').trim();

function count(pattern: RegExp, text: string): number {
  pattern.lastIndex = 0;
  let n = 0;
  while (pattern.exec(text) !== null) n += 1;
  pattern.lastIndex = 0;
  return n;
}

/** `tab`: the page the Impressum link opened; `homepage`: the homepage of the same capture. */
export function checkImpressumPage(tab: PageSnapshot, homepage: PageSnapshot | null): ImpressumPageVerdict {
  const title = squash(tab.title);
  const text = stripInvisible(tab.text);
  // The text is read line by line with a bound, so one huge line costs nothing.
  const errorLine = text.split('\n', 400).some((line) => {
    const short = line.trim();
    return short.length > 0 && short.length <= 80 && ERROR_LINE.test(short);
  });
  if (ERROR_TITLE.test(title) || errorLine) return { impressum: false, reason: 'error-page', message: 'the page behind the Impressum link says that it does not exist' };
  // The homepage again under another address (a query, /index.html, without www): same title and same text.
  if (homepage !== null && squash(homepage.title) === title && squash(homepage.text) === squash(tab.text)) {
    return { impressum: false, reason: 'homepage', message: 'the Impressum link led back to the homepage' };
  }
  // A sign of an Impressum: the word in the title, a sentence of a legal notice, or the word in the
  // text outside the texts of the links (every page of a site carries the word in its footer link).
  const inLinks = tab.links.filter((link) => count(IMPRESSUM_WORD, stripInvisible(link.text)) > 0).length;
  if (count(IMPRESSUM_WORD, title) > 0 || NOTICE_PHRASE.test(text.slice(0, 200_000)) || count(IMPRESSUM_WORD, text.slice(0, 200_000)) > inLinks) return { impressum: true };
  return { impressum: false, reason: 'no-sign', message: 'the page behind the Impressum link does not look like an Impressum' };
}
