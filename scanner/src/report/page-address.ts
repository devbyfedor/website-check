/**
 * Addresses of the scanned page in the report (session fix-a5, review finding 90): the report is stored in D1
 * and handed to every visitor who asks for the same site within 24 hours, so an address keeps only what names
 * the page, never what the page added for our browser (a session id for a visitor without cookies, a token,
 * the client id of an analytics request, the page address with an e-mail inside it).
 *
 * The rule: scheme, host, port and path; no query, no fragment, no user name or password, and no session id
 * that a Java or PHP server puts into the path (`;jsessionid=…`). Two exceptions keep parameters that name a
 * page or a font and say nothing about the visitor (docs/decisions.md, fix-a5):
 * - a link to a legal page whose path is "/" or a script (`index.php`): the query chooses the page there
 *   (WordPress without permalinks `?page_id=7`, TYPO3 `?id=12`, Joomla, OpenCart); only parameters of a fixed
 *   list with a short plain value are kept, otherwise the report would show the homepage as the Impressum link;
 * - a Google Fonts stylesheet: `family` and `display` name the fonts, which the fix (load these fonts from
 *   the site itself) needs.
 * Addresses of other schemes (`data:`, `blob:`) carry no query of a page and are returned as they are.
 */

const WEB_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** Parameters that choose a page in common systems; their values are page numbers or names, not visitor data. */
const PAGE_SELECTORS = new Set(['page_id', 'p', 'id', 'page', 'pageid', 'seite', 'site', 'cat', 'l', 'lang', 'option', 'view', 'itemid', 'route', 'information_id', 'content', 'article', 'action', 'cmd']);
const PLAIN_VALUE = /^[A-Za-z0-9._/-]{1,40}$/;
const SCRIPT_PATH = /(^\/$|\.(php|php5|asp|aspx|jsp|cfm|cgi|pl)$)/i;
const GOOGLE_FONTS_CSS = /^\/css2?$/;
const FONT_PARAMETERS = new Set(['family', 'display']);
/** `;jsessionid=…` and the like: a session id in a path segment (servers add it when the visitor has no cookie). */
const PATH_SESSION = /;(jsessionid|phpsessid|sessionid|sid)=[^/;]*/gi;

function keptQuery(url: URL, keep: (name: string, value: string) => boolean): string {
  const kept = new URLSearchParams();
  for (const [name, value] of url.searchParams) if (keep(name, value)) kept.append(name, value);
  const text = kept.toString();
  return text === '' ? '' : `?${text}`;
}

function cutAtQuery(text: string): string {
  const end = text.search(/[?#]/);
  return end === -1 ? text : text.slice(0, end);
}

/**
 * The address of a request, a page or a link as the report keeps it. `kind` `link` is a link to a legal page
 * (Impressum, Datenschutzerklärung, Erklärung zur Barrierefreiheit) or the address the Impressum was read from.
 */
export function pageAddress(raw: string, kind: 'request' | 'page' | 'link' = 'request'): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not an address the URL parser reads (for example cut at a limit): everything from the query on goes.
    return /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^(https?|wss?):/i.test(raw) ? raw : cutAtQuery(raw).replace(PATH_SESSION, '');
  }
  if (!WEB_SCHEMES.has(url.protocol)) return raw;
  const path = url.pathname.replace(PATH_SESSION, '');
  let query = '';
  if (kind === 'link' && SCRIPT_PATH.test(path)) {
    query = keptQuery(url, (name, value) => PAGE_SELECTORS.has(name.toLowerCase()) && PLAIN_VALUE.test(value));
  } else if (url.hostname === 'fonts.googleapis.com' && GOOGLE_FONTS_CSS.test(path)) {
    query = keptQuery(url, (name) => FONT_PARAMETERS.has(name));
  }
  return `${url.protocol}//${url.host}${path}${query}`;
}
