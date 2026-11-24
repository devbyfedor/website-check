import { describe, expect, it } from 'vitest';
import type { PageSnapshot } from '../src/capture/types.ts';
import { extractImpressumFields } from '../src/legal/fields.ts';
import { decodeHtml, SNAPSHOT_LINK_TEXT_LENGTH, SNAPSHOT_MAX_LINKS, snapshotFromHtml } from '../src/quick/html-snapshot.ts';

/**
 * Session A5 part 3: an adversarial review of the quick check's HTML reader (`scanner/src/quick/html-snapshot.ts`).
 *
 * Every expected value in `CASES` is what Chromium itself returned: the local Chromium 159 of Playwright opened each
 * synthetic page, served from the fixed origin https://edge.example with every other request aborted (no network),
 * and evaluated `SNAPSHOT_EXPRESSION`; recorded on 2026-11-23. Invented firms and `.example` domains only.
 *
 * - `fixed`: a defect this review found; the quick snapshot differed from Chromium before the fix in html-snapshot.ts.
 * - `checked`: a suspicion that turned out fine (the quick snapshot already gave Chromium's result); kept as a guard.
 * - `known`: a difference static HTML cannot remove or the spec allows, with the reason. The test checks that it still
 *   exists, so a difference that goes away must move to `checked`.
 */

const ORIGIN = 'https://edge.example';
const doc = (body: string, head = ''): string => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title>${head}</head><body>${body}</body></html>`;
const page = (body: string, head = ''): string => `<!doctype html><html lang="de"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

type LinkTuple = [string, string] | [string, string, boolean];

interface Expected {
  title: string;
  lang: string | null;
  text: string;
  /** [href, text] or [href, text, footer]. */
  links: LinkTuple[];
  securityMeta?: { csp: string | null; referrer: string | null };
  generators?: string[];
  selectors?: string[];
}

interface EdgeCase {
  name: string;
  group: 'fixed' | 'checked' | 'known';
  known?: string;
  html: string;
  chromium: Expected;
}

const normalized = (e: Expected): Required<Expected> => ({
  title: e.title,
  lang: e.lang,
  text: e.text,
  links: e.links.map((l): LinkTuple => (l[2] === true ? l : [l[0], l[1]])),
  securityMeta: e.securityMeta ?? { csp: null, referrer: null },
  generators: e.generators ?? [],
  selectors: e.selectors ?? [],
});

const quickParts = (snap: PageSnapshot): Required<Expected> =>
  normalized({
    title: snap.title,
    lang: snap.lang,
    text: snap.text,
    links: snap.links.map((l): LinkTuple => (l.footer === true ? [l.href, l.text, true] : [l.href, l.text])),
    securityMeta: snap.securityMeta,
    generators: snap.platform?.generators,
    selectors: snap.platform?.selectors,
  });

const quick = (c: EdgeCase): PageSnapshot => snapshotFromHtml(c.html, `${ORIGIN}/${c.name}.html`, { platform: true });

const CASES: EdgeCase[] = [
  { name: 'script-double-escaped', group: 'fixed',
    html: doc('<p>vor</p><script><!-- document.write("<script src=\'x.js\'></script>"); //--></script><p>nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor\n\nnach', links: [] } },
  { name: 'script-escaped-ends', group: 'checked',
    html: doc('<p>vor</p><script><!-- var a = 1; </script><p>nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor\n\nnach', links: [] } },
  { name: 'script-escaped-then-arrow', group: 'checked',
    html: doc('<p>vor</p><script><!--<script>--></script><p>nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor\n\nnach', links: [] } },
  { name: 'script-escape-start-empty', group: 'checked',
    html: doc('<p>vor</p><script><!--></script><p>nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor\n\nnach', links: [] } },
  { name: 'script-double-close-inside', group: 'fixed',
    html: doc('<p>vor</p><script><!-- <script> x </script> y </script><p>nach</p>-->z</script><p>ende</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor\n\nnach\n\n-->z\n\nende', links: [] } },
  { name: 'script-in-head-double-escaped', group: 'fixed',
    html: '<!doctype html><html lang="de"><head><title>T</title><script><!--\ndocument.write(\'<script src="a.js"></script>\');\n//--></script><meta name="generator" content="WordPress 6"></head><body class="woocommerce"><p>Text</p></body></html>',
    chromium: { title: 'T', lang: 'de', text: 'Text', links: [], generators: ['WordPress 6'], selectors: ['body.woocommerce, body.woocommerce-page'] } },
  { name: 'link-in-closed-details', group: 'fixed',
    html: doc('<details><summary>Rechtliches</summary><a href="/impressum">Impressum</a></details><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'Rechtliches\n\nx', links: [['https://edge.example/impressum', '']] } },
  { name: 'link-in-open-details', group: 'checked',
    html: doc('<details open><summary>Rechtliches</summary><a href="/impressum">Impressum</a></details>'),
    chromium: { title: 'T', lang: 'de', text: 'Rechtliches\nImpressum', links: [['https://edge.example/impressum', 'Impressum']] } },
  { name: 'link-in-until-found', group: 'fixed',
    html: doc('<div hidden="until-found"><a href="/impressum">Impressum</a></div><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'x', links: [['https://edge.example/impressum', '']] } },
  { name: 'link-until-found-self', group: 'fixed',
    html: doc('<a hidden="until-found" href="/impressum" title="T">Impressum</a><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'Impressum\n\nx', links: [['https://edge.example/impressum', 'Impressum']] } },
  { name: 'cv-hidden-inline', group: 'fixed',
    html: doc('<div style="content-visibility:hidden"><a href="/impressum">Impressum</a> text</div><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'x', links: [['https://edge.example/impressum', '']] } },
  { name: 'template-html-body', group: 'fixed',
    html: '<!doctype html><html><head><template><html lang="en"><body class="woocommerce"></template></head><body><p>x</p></body></html>',
    chromium: { title: '', lang: null, text: 'x', links: [] } },
  { name: 'foster-text', group: 'known', known: 'foster parenting is not done: text directly in a <table> stays inside the table instead of moving before it',
    html: doc('<table>Text<tr><td>x</td></tr></table>'),
    chromium: { title: 'T', lang: 'de', text: 'Text\nx', links: [] } },
  { name: 'foster-link', group: 'known', known: 'foster parenting is not done: a link directly in a <table> stays after the rows instead of moving before the table',
    html: doc('<table><tr><td>x</td></tr><a href="/impressum">Impressum</a></table>'),
    chromium: { title: 'T', lang: 'de', text: 'Impressum\nx', links: [['https://edge.example/impressum', 'Impressum']] } },
  { name: 'aaa-div', group: 'known', known: 'the adoption agency algorithm is simplified: Chromium splits a link around a block (an extra empty copy of the link)',
    html: doc('<a href="/a"><div>text</a>more</div>'),
    chromium: { title: 'T', lang: 'de', text: 'textmore', links: [['https://edge.example/a', ''], ['https://edge.example/a', 'text']] } },
  { name: 'aaa-nested-a', group: 'known', known: 'the adoption agency algorithm is simplified: Chromium splits the outer link around the block before the inner link',
    html: doc('<a href="/a"><div>A<a href="/b">B</a></div>'),
    chromium: { title: 'T', lang: 'de', text: 'AB', links: [['https://edge.example/a', ''], ['https://edge.example/a', 'A'], ['https://edge.example/b', 'B']] } },
  { name: 'p-inline-block', group: 'fixed',
    html: doc('<div>a<p style="display:inline-block">b</p>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb\n\nc', links: [] } },
  { name: 'p-inline', group: 'checked',
    html: doc('<div>a<p style="display:inline">b</p>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb\n\nc', links: [] } },
  { name: 'p-contents', group: 'checked',
    html: doc('<div>a<p style="display:contents">b</p>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'abc', links: [] } },
  { name: 'entities-attr', group: 'fixed',
    html: doc('<a href="/?a=1&reg&lang=de&copy=2&notit=3&amp;b">x</a><a href="/?x=&notin;">y</a>'),
    chromium: { title: 'T', lang: 'de', text: 'xy', links: [['https://edge.example/?a=1%C2%AE&lang=de&copy=2&notit=3&b', 'x'], ['https://edge.example/?x=%E2%88%89', 'y']] } },
  { name: 'label-ws-only', group: 'checked',
    html: doc('<p>Text<a href="/x" aria-label="Impressum"> </a>more</p><p>Text <a href="/y" aria-label="Datenschutz"> </a> more</p><a href="/z" title="AGB"><br></a>'),
    chromium: { title: 'T', lang: 'de', text: 'Text more\n\nText more\n\n\n', links: [['https://edge.example/x', ''], ['https://edge.example/y', 'Datenschutz'], ['https://edge.example/z', '']] } },
  { name: 'label-display-contents', group: 'checked',
    html: doc('<a href="/x" style="display:contents">Impressum</a>'),
    chromium: { title: 'T', lang: 'de', text: 'Impressum', links: [['https://edge.example/x', 'Impressum']] } },
  { name: 'label-visibility', group: 'checked',
    html: doc('<a href="/x" style="visibility:hidden" aria-label="L">Impressum</a><a href="/y" style="visibility:hidden"><span style="visibility:visible">Sichtbar</span> nicht</a>'),
    chromium: { title: 'T', lang: 'de', text: 'Sichtbar', links: [['https://edge.example/x', 'L'], ['https://edge.example/y', 'Sichtbar']] } },
  { name: 'select-in-p', group: 'fixed',
    html: doc('<p>Land: <select><option>Deutschland</option><optgroup label="G"><option>Österreich</option></optgroup><option label="">leer</option></select> Ende</p>'),
    chromium: { title: 'T', lang: 'de', text: 'Land: \nDeutschland\nÖsterreich\nleer\n Ende', links: [] } },
  { name: 'button-label', group: 'checked',
    html: doc('<p>a<button>Senden</button>b <label>Name <input value="x"></label></p>'),
    chromium: { title: 'T', lang: 'de', text: 'aSendenb Name ', links: [] } },
  { name: 'br-end', group: 'checked',
    html: doc('<p>a<br></p><p>b</p><div><br>c</div><p></p><p>d</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\n\nb\n\n\nc\n\nd', links: [] } },
  { name: 'nbsp', group: 'checked',
    html: doc('<p>a&nbsp; b &nbsp;c&nbsp;</p><p>&nbsp;</p><p>e</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a\u00a0 b \u00a0c\u00a0\n\n\u00a0\n\ne', links: [] } },
  { name: 'table-sections', group: 'checked',
    html: doc('<table><caption>Titel</caption><tfoot><tr><td>F</td></tr></tfoot><tbody><tr><td>B1</td><td>B2</td></tr></tbody><thead><tr><th>H</th></tr></thead></table>'),
    chromium: { title: 'T', lang: 'de', text: 'Titel\nF\nB1\tB2\nH', links: [] } },
  { name: 'table-nested', group: 'checked',
    html: doc('<table><tr><td>a<table><tr><td>i1</td><td>i2</td></tr></table></td><td>b</td></tr></table>'),
    chromium: { title: 'T', lang: 'de', text: 'a\ni1\ti2\n\tb', links: [] } },
  { name: 'tok-missing-space', group: 'checked',
    html: doc('<a href="/x"title="Impressum"></a><a href=/y/>Y</a><a/href="/z">Z</a><a href = \'/w\' >W</a>'),
    chromium: { title: 'T', lang: 'de', text: 'YZW', links: [['https://edge.example/x', 'Impressum'], ['https://edge.example/y/', 'Y'], ['https://edge.example/z', 'Z'], ['https://edge.example/w', 'W']] } },
  { name: 'tok-comments', group: 'checked',
    html: doc('<p>a<!--x--!>b<!-- -- -->c<!--->d-->e<!-- <a href="/c">c</a> -->f</p>'),
    chromium: { title: 'T', lang: 'de', text: 'abcd-->ef', links: [] } },
  { name: 'tok-end-tags', group: 'checked',
    html: doc('<p>a</p >b</p foo="bar">c</ p>d</P>e'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb\n\ncd\n\ne', links: [] } },
  { name: 'tok-stray-lt', group: 'checked',
    html: doc('<p>1 < 2 <3 <= 4 <-x <!x> y <?php z ?> w</p>'),
    chromium: { title: 'T', lang: 'de', text: '1 < 2 <3 <= 4 <-x y w', links: [] } },
  { name: 'tok-attr-gt', group: 'checked',
    html: doc('<a title="a>b" href="/x" data-a=\'x"y>\'>T</a><a title=a>b href="/y">U</a>'),
    chromium: { title: 'T', lang: 'de', text: 'Tb href="/y">U', links: [['https://edge.example/x', 'T']] } },
  { name: 'tok-title-entity', group: 'checked',
    html: '<!doctype html><title>A &amp; B &lt;i&gt; &copy</title><p>x',
    chromium: { title: 'A & B <i> ©', lang: null, text: 'x', links: [] } },
  { name: 'tok-xmp-plaintext', group: 'checked',
    html: doc('<xmp><b>fett</b> &amp;</xmp><p>p</p><plaintext><a href="/x">x</a></p>'),
    chromium: { title: 'T', lang: 'de', text: '<b>fett</b> &amp;\n\np\n\n<a href="/x">x</a></p></body></html>', links: [] } },
  { name: 'tok-textarea-title-body', group: 'checked',
    html: doc('<p>a<textarea><a href="/t">t</a></textarea>b<title>Body&amp;Titel</title>c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'abc', links: [] } },
  { name: 'tok-nul-cr', group: 'checked',
    html: '<!doctype html><p>a\r\nb\rc\u0000d</p><a href="/x\r\ny">e</a>',
    chromium: { title: '', lang: null, text: 'a b cd\n\ne', links: [['https://edge.example/xy', 'e']] } },
  { name: 'tok-uppercase', group: 'checked',
    html: '<!DOCTYPE HTML><HTML LANG="DE"><HEAD><TITLE>Gross</TITLE></HEAD><BODY><P>A<BR>B</P><A HREF="/X" ARIA-LABEL="L"></A></BODY></HTML>',
    chromium: { title: 'Gross', lang: 'DE', text: 'A\nB', links: [['https://edge.example/X', 'L']] } },
  { name: 'tree-p-div', group: 'checked',
    html: doc('<div><p>a<div>b</div>c</p></div>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb\nc', links: [] } },
  { name: 'tree-lists', group: 'checked',
    html: doc('<ul><li>a<ul><li>b</ul><li>c</ul><dl><dt>t<dd>d<dt>t2</dl><ol><li>x<li>y</ol>'),
    chromium: { title: 'T', lang: 'de', text: 'a\nb\nc\nt\nd\nt2\nx\ny', links: [] } },
  { name: 'tree-headings', group: 'checked',
    html: doc('<h1>a<h2>b</h1>c<h3>d</h3>'),
    chromium: { title: 'T', lang: 'de', text: 'a\nb\nc\nd', links: [] } },
  { name: 'tree-formatting', group: 'checked',
    html: doc('<b><p>x</b>y</p><i>a<div>b</i>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'xy\n\na\nbc', links: [] } },
  { name: 'tree-button-p', group: 'checked',
    html: doc('<button><p>a</button>b'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb', links: [] } },
  { name: 'tree-a-in-li', group: 'checked',
    html: doc('<ul><li><a href="/1">Eins<li><a href="/2">Zwei</ul>'),
    chromium: { title: 'T', lang: 'de', text: 'Eins\nZwei', links: [['https://edge.example/1', 'Eins'], ['https://edge.example/2', 'Zwei']] } },
  { name: 'tree-a-across-div', group: 'checked',
    html: doc('<a href="/x">text<div>block</div><p>para'),
    chromium: { title: 'T', lang: 'de', text: 'text\nblock\n\npara', links: [['https://edge.example/x', 'text block para']] } },
  { name: 'tree-a-td', group: 'checked',
    html: doc('<a href="/1"><table><tr><td><a href="/2">innen</a></td></tr></table>aussen</a>'),
    chromium: { title: 'T', lang: 'de', text: 'innen\naussen', links: [['https://edge.example/1', 'innen aussen'], ['https://edge.example/2', 'innen']] } },
  { name: 'tree-option-outside', group: 'checked',
    html: doc('<p>a<option>b<option>c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a\nb\nc', links: [] } },
  { name: 'svg-foreignobject-link', group: 'known', known: 'SVG content is not rendered: Chromium shows the HTML inside <foreignObject>',
    html: doc('<p>vor</p><svg><foreignObject><a href="/x">Link</a><p>fo</p></foreignObject></svg><p>nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor\n\nLink\n\nfo\n\nnach', links: [['https://edge.example/x', 'Link']] } },
  { name: 'svg-breakout', group: 'checked',
    html: doc('<svg><g><p>raus</p><a href="/s">svg-a</a></g></svg>'),
    chromium: { title: 'T', lang: 'de', text: 'raus\n\nsvg-a', links: [['https://edge.example/s', 'svg-a']] } },
  { name: 'math-mtext-link', group: 'known', known: 'MathML is read as inline text; Chromium lays it out as blocks and draws <mi>x</mi> as a mathematical italic letter',
    html: doc('<p>vor <math><mi>x</mi><mtext><a href="/m">MLink</a></mtext></math> nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor \n𝑥\nMLink\n nach', links: [['https://edge.example/m', 'MLink']] } },
  { name: 'svg-in-link', group: 'checked',
    html: doc('<a href="/x"><svg><title>Icon</title><path d="M0"/></svg>Impressum</a>'),
    chromium: { title: 'T', lang: 'de', text: 'Impressum', links: [['https://edge.example/x', 'Impressum']] } },
  { name: 'svg-style-not-raw', group: 'checked',
    html: doc('<svg><style><a href="/x">a</a></style></svg><p>y</p>'),
    chromium: { title: 'T', lang: 'de', text: 'y', links: [['https://edge.example/x', '']] } },
  { name: 'label-cases', group: 'checked',
    html: doc('<a href="/1"><img alt="Impressum"></a><a href="/2"><span style="display:none">Hidden</span>Visible</a><a href="/3">Im<span style="display:block">pres</span>sum</a><a href="/4">Im&shy;pres<wbr>sum&#8203;</a><a href="/5" title="T">  </a><a href="/6">😀xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</a>'),
    chromium: { title: 'T', lang: 'de', text: 'VisibleIm\npres\nsumIm\u00adpressum\u200b 😀xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', links: [['https://edge.example/1', ''], ['https://edge.example/2', 'Visible'], ['https://edge.example/3', 'Im pres sum'], ['https://edge.example/4', 'Im\u00adpressum\u200b'], ['https://edge.example/5', ''], ['https://edge.example/6', '😀xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx']] } },
  { name: 'base-cases', group: 'checked',
    html: doc('<a href="a">1</a>', '<base target="_blank"><base href=""><base href="/zwei/">'),
    chromium: { title: 'T', lang: 'de', text: '1', links: [['https://edge.example/a', '1']] } },
  { name: 'base-late', group: 'checked',
    html: doc('<a href="a">1</a><base href="https://cdn.example/b/">'),
    chromium: { title: 'T', lang: 'de', text: '1', links: [['https://cdn.example/b/a', '1']] } },
  { name: 'footer-cases', group: 'checked',
    html: doc('<article><footer><a href="/1">1</a></footer></article><header><nav class="footer-nav"><a href="/2">2</a></nav></header><div class="Footer-x"><template><header></header></template><a href="/3">3</a></div><div id="footer"><div role="banner"></div><a href="/4">4</a></div><div class="footer"><svg><a href="/5">5</a></svg></div><span class="footer"><b><a href="/6">6</a></b></span>'),
    chromium: { title: 'T', lang: 'de', text: '1\n2\n3\n4\n6', links: [['https://edge.example/1', '1', true], ['https://edge.example/2', '2', true], ['https://edge.example/3', '3', true], ['https://edge.example/4', '4'], ['https://edge.example/5', '', true], ['https://edge.example/6', '6', true]] } },
  { name: 'platform-cases', group: 'checked',
    html: '<!doctype html><html><head><META NAME="Generator" CONTENT="TYPO3 CMS"><meta name="generator"><noscript><meta name="generator" content="NoScript"><link id="wp-block-library-css"></noscript><LINK ID="wp-block-library-css" REL=stylesheet></head><BODY CLASS="woocommerce-page"><div class="shopify-section" id="Shopify-section-x"></div><div data-cookie-permission class="cookie-permission-container"></div><meta name="referrer" content="no-referrer"><meta http-equiv="content-security-policy" content="x"></body></html>',
    chromium: { title: '', lang: null, text: '', links: [], securityMeta: { csp: null, referrer: 'no-referrer' }, generators: ['TYPO3 CMS', ''], selectors: ['link#wp-block-library-css, style#wp-block-library-inline-css', 'body.woocommerce, body.woocommerce-page', 'div.cookie-permission-container[data-cookie-permission]'] } },
  { name: 'p-inline-flex', group: 'fixed',
    html: doc('<div>a<p style="display:inline-flex">b</p>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb\n\nc', links: [] } },
  { name: 'p-cell', group: 'checked',
    html: doc('<div>a<p style="display:table-cell">b</p>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'abc', links: [] } },
  { name: 'p-flex-item', group: 'checked',
    html: doc('<div style="display:flex">a<p>b</p>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb\n\nc', links: [] } },
  { name: 'p-float', group: 'checked',
    html: doc('<div>a<p style="float:left">b</p>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb\n\nc', links: [] } },
  { name: 'p-in-inline-block', group: 'checked',
    html: doc('<div>a<span style="display:inline-block"><p>b</p></span>c</div>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb\n\nc', links: [] } },
  { name: 'cv-auto-offscreen', group: 'known', known: 'content-visibility: auto skips content outside the viewport, which only layout knows',
    html: doc('<div style="height:5000px">oben</div><div style="content-visibility:auto"><a href="/impressum">Impressum</a> unten</div>'),
    chromium: { title: 'T', lang: 'de', text: 'oben', links: [['https://edge.example/impressum', '']] } },
  { name: 'cv-hidden-inline-el', group: 'checked',
    html: doc('<p>a <span style="content-visibility:hidden">b <a href="/x">L</a></span> c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a b L c', links: [['https://edge.example/x', 'L']] } },
  { name: 'cv-hidden-on-link-block', group: 'fixed',
    html: doc('<a href="/x" style="display:block;content-visibility:hidden" title="T">Impressum</a><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'x', links: [['https://edge.example/x', 'T']] } },
  { name: 'until-found-span', group: 'fixed',
    html: doc('<p>a <span hidden="until-found">b <a href="/x">L</a></span> c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a b L c', links: [['https://edge.example/x', 'L']] } },
  { name: 'until-found-upper', group: 'fixed',
    html: doc('<div hidden="UNTIL-FOUND"><a href="/x">L</a> b</div><p>c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'c', links: [['https://edge.example/x', '']] } },
  { name: 'until-found-display-none', group: 'checked',
    html: doc('<div hidden="until-found" style="display:none"><a href="/x">L</a> b</div><p>c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'c', links: [['https://edge.example/x', 'L']] } },
  { name: 'until-found-in-display-none', group: 'checked',
    html: doc('<div style="display:none"><div hidden="until-found"><a href="/x">L</a></div></div><p>c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'c', links: [['https://edge.example/x', 'L']] } },
  { name: 'details-in-display-none', group: 'checked',
    html: doc('<div style="display:none"><details><summary>S</summary><a href="/x">L</a></details></div><p>c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'c', links: [['https://edge.example/x', 'L']] } },
  { name: 'details-hidden-link-inside', group: 'fixed',
    html: doc('<details><summary>S <a href="/s">SL</a></summary><div style="display:none"><a href="/x">L</a></div><summary>Zweite</summary>t</details><p>c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'S SL\n\nc', links: [['https://edge.example/s', 'SL'], ['https://edge.example/x', '']] } },
  { name: 'details-display-block-style', group: 'fixed',
    html: doc('<details style="display:block"><summary>S</summary><a href="/x">L</a></details><p>c</p>'),
    chromium: { title: 'T', lang: 'de', text: 'S\n\nc', links: [['https://edge.example/x', '']] } },
  { name: 'svg-text', group: 'known', known: 'SVG <text> is not rendered (the spec allows to skip it); Chromium shows it as a line of its own',
    html: doc('<p>a <svg width="50" height="20"><text x="0" y="15">Grafik</text></svg> b</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a \nGrafik\n b', links: [] } },
  { name: 'svg-fo-inline', group: 'known', known: 'SVG content is not rendered: Chromium shows the HTML inside <foreignObject>',
    html: doc('<p>vor <svg width="50" height="20"><foreignObject width="50" height="20"><span>x</span></foreignObject></svg> nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor \nx\n nach', links: [] } },
  { name: 'svg-fo-hidden', group: 'fixed',
    html: doc('<p>vor <svg width="50" height="20" style="display:none"><foreignObject><a href="/x">L</a></foreignObject></svg> nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor nach', links: [['https://edge.example/x', 'L']] } },
  { name: 'option-labels', group: 'fixed',
    html: doc('<p><select><option label=" ">ws</option><option>  a  <b>b</b> </option><option label="L">x</option></select></p>'),
    chromium: { title: 'T', lang: 'de', text: 'ws\na b\nx', links: [] } },
  { name: 'ex-blocks', group: 'checked',
    html: page('<h1>Impressum</h1><p>Muster Rösterei GmbH<br>\nBohnenweg 7<br>54321 Kaffeestadt</p><div>Kontakt</div><div><div>innen</div></div>'),
    chromium: { title: '', lang: 'de', text: 'Impressum\n\nMuster Rösterei GmbH\nBohnenweg 7\n54321 Kaffeestadt\n\nKontakt\ninnen', links: [] } },
  { name: 'ex-whitespace', group: 'checked',
    html: page('<p>   Kaffee    <b>  und </b>   Kuchen  </p>\n\n  <div>\n  Ende <br>  neu  </div>'),
    chromium: { title: '', lang: 'de', text: 'Kaffee und Kuchen\n\nEnde\nneu', links: [] } },
  { name: 'ex-atomic-1', group: 'checked',
    html: page('<p><img src="logo.png" alt="Logo"> Text</p>'),
    chromium: { title: '', lang: 'de', text: ' Text', links: [] } },
  { name: 'ex-atomic-2', group: 'checked',
    html: page('<p>a <span style="display:inline-block">  b  </span> c</p>'),
    chromium: { title: '', lang: 'de', text: 'a b c', links: [] } },
  { name: 'ex-atomic-3', group: 'checked',
    html: page('<p>Feld: <input value="geheim"> Ende</p>'),
    chromium: { title: '', lang: 'de', text: 'Feld:  Ende', links: [] } },
  { name: 'ex-tables-1', group: 'checked',
    html: page('<table><tr><td>Firma<td>Muster Rösterei GmbH<tr><th>HRB<td>98765</table><p>a<p>b<ul><li>eins<li>zwei</ul>'),
    chromium: { title: '', lang: 'de', text: 'Firma\tMuster Rösterei GmbH\nHRB\t98765\n\na\n\nb\n\neins\nzwei', links: [] } },
  { name: 'ex-tables-2', group: 'checked',
    html: page('<table><tbody><tr><td>a</td><td></td></tr></tbody><tfoot><tr><td>c</td></tr></tfoot></table>'),
    chromium: { title: '', lang: 'de', text: 'a\t\nc', links: [] } },
  { name: 'ex-pre-1', group: 'checked',
    html: page('<pre>\n  Zeile 1\n    Zeile 2</pre><div>x</div>'),
    chromium: { title: '', lang: 'de', text: '  Zeile 1\n    Zeile 2\nx', links: [] } },
  { name: 'ex-pre-2', group: 'checked',
    html: page('<p style="white-space: pre-line">  a   b  \n  c</p>'),
    chromium: { title: '', lang: 'de', text: 'a b\nc', links: [] } },
  { name: 'ex-entities', group: 'checked',
    html: page('<p>Gr&uuml;&szlig;e &amp; mehr&nbsp;Text &#8211; &#x2014; &euro; &copy 2026 &auml; &#150; &#64;&commat; &foo; &amp;x Stra&shy;ße</p>'),
    chromium: { title: '', lang: 'de', text: 'Grüße & mehr\u00a0Text – — € © 2026 ä – @@ &foo; &x Stra\u00adße', links: [] } },
  { name: 'ex-hidden', group: 'known', known: 'SVG <text> is not rendered (the spec allows to skip it); Chromium shows it as a line of its own',
    html: page('<p>a<span hidden>B</span>c<span style="display: none !important">D</span>e<span style="visibility:hidden">F</span>g</p><script>var h = "<p>H</p>";</script><style>p{}</style><noscript><p>Bitte JavaScript</p></noscript><template><p>T</p></template><textarea>Notiz</textarea><svg><text>Grafik</text></svg><dialog><p>Dialog</p></dialog><input type="hidden" value="x">'),
    chromium: { title: '', lang: 'de', text: 'aceg\n\nGrafik', links: [] } },
  { name: 'ex-details-closed', group: 'checked',
    html: page('<details><summary>Mehr</summary><p>Versteckt</p></details>'),
    chromium: { title: '', lang: 'de', text: 'Mehr', links: [] } },
  { name: 'ex-details-open', group: 'checked',
    html: page('<details open><summary>Mehr</summary><p>Sichtbar</p></details>'),
    chromium: { title: '', lang: 'de', text: 'Mehr\n\nSichtbar', links: [] } },
  { name: 'ex-style-1', group: 'checked',
    html: page('<p>a<span style="display:block">b</span>c</p>'),
    chromium: { title: '', lang: 'de', text: 'a\nb\nc', links: [] } },
  { name: 'ex-style-2', group: 'checked',
    html: page('<div style="display:flex"><a href="/1">Eins</a> <a href="/2">Zwei</a> Text </div>'),
    chromium: { title: '', lang: 'de', text: 'Eins\nZwei\nText', links: [['https://edge.example/1', 'Eins'], ['https://edge.example/2', 'Zwei']] } },
  { name: 'ex-style-3', group: 'checked',
    html: page('<div style="visibility:hidden">x<span style="visibility:visible">sichtbar</span></div>'),
    chromium: { title: '', lang: 'de', text: 'sichtbar', links: [] } },
  { name: 'ex-style-4', group: 'checked',
    html: page('<p>a<span style="float:left">b</span>c</p>'),
    chromium: { title: '', lang: 'de', text: 'a\nb\nc', links: [] } },
  { name: 'ex-style-5', group: 'checked',
    html: page('<p style="text-transform:uppercase">laut</p>'),
    chromium: { title: '', lang: 'de', text: 'LAUT', links: [] } },
  { name: 'ex-select', group: 'fixed',
    html: page('<p>Land: <select><option>Deutschland</option><option label="AT">Österreich</select> Ende</p>'),
    chromium: { title: '', lang: 'de', text: 'Land: \nDeutschland\nÖsterreich\n Ende', links: [] } },
  { name: 'ex-tolerant-1', group: 'checked',
    html: page('<!-- <p>kommentar</p> --><P>1 < 2 und 3 <4 <!---->x</P><!--->y<![CDATA[z]]>w'),
    chromium: { title: '', lang: 'de', text: '1 < 2 und 3 <4 x\n\nyw', links: [] } },
  { name: 'ex-tolerant-2', group: 'checked',
    html: page('<div>a<!-- unclosed comment <p>b</p>'),
    chromium: { title: '', lang: 'de', text: 'a', links: [] } },
  { name: 'ex-tolerant-3', group: 'checked',
    html: page('<p>a</p></p><p>b'),
    chromium: { title: '', lang: 'de', text: 'a\n\nb', links: [] } },
  { name: 'ex-raw', group: 'known', known: 'a script writes the link',
    html: page('<script>document.write("<a href=\\"/js\\">x</a></scr" + "ipt>")</script><textarea><a href="/ta">y</a></textarea><p>sichtbar</p>'),
    chromium: { title: '', lang: 'de', text: 'x\n\nsichtbar', links: [['https://edge.example/js', 'x']] } },
  { name: 'ex-body-hidden', group: 'checked',
    html: '<body hidden><p>a</p>\n<p>b</p><script>c</script></body>',
    chromium: { title: '', lang: null, text: 'a\nbc', links: [] } },
  { name: 'ex-labels', group: 'checked',
    html: page('<a href="/1">  Impressum\n  &amp;   Datenschutz </a><a href="/2" aria-label="Impressum"><img src="i.svg" alt="Impressum"></a><a href="/3" title="Datenschutz"><svg></svg></a><a href="/4"><img src="x.png" alt=""></a><a href="/5">Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort </a><a href="/6"><span aria-hidden="true">§</span> <span>IMPRESSUM</span></a><a href="/7">Kon<br>takt</a>'),
    chromium: { title: '', lang: 'de', text: 'Impressum & Datenschutz Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort § IMPRESSUMKon\ntakt', links: [['https://edge.example/1', 'Impressum & Datenschutz'], ['https://edge.example/2', 'Impressum'], ['https://edge.example/3', 'Datenschutz'], ['https://edge.example/4', ''], ['https://edge.example/5', 'Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort Wort '], ['https://edge.example/6', '§ IMPRESSUM'], ['https://edge.example/7', 'Kon takt']] } },
  { name: 'ex-hidden-link', group: 'checked',
    html: page('<div hidden><a href="/x"> Ver<br>steckt  <span>Link</span></a></div><a href="/y" style="display:none">Auch<script>s</script></a>'),
    chromium: { title: '', lang: 'de', text: '', links: [['https://edge.example/x', 'Versteckt Link'], ['https://edge.example/y', 'Auchs']] } },
  { name: 'ex-svg-link', group: 'known', known: 'SVG <text> is not rendered (the spec allows to skip it); Chromium shows it as a line of its own',
    html: page('<svg><a href="/svg" aria-label="Karte"><text>Text</text></a></svg>'),
    chromium: { title: '', lang: 'de', text: 'Text', links: [['https://edge.example/svg', 'Karte']] } },
  { name: 'ex-reopen', group: 'checked',
    html: page('<p><a href="/x">eins</p><p>zwei</p><a href="/a">A<a href="/b">B</a><ul><li><a href="/1">Eins</li><li><a href="/2">Zwei</a></li></ul>'),
    chromium: { title: '', lang: 'de', text: 'eins\n\nzwei\n\nAB\nEins\nZwei', links: [['https://edge.example/x', 'eins'], ['https://edge.example/x', 'zwei'], ['https://edge.example/a', 'A'], ['https://edge.example/b', 'B'], ['https://edge.example/1', 'Eins'], ['https://edge.example/2', 'Zwei']] } },
  { name: 'ex-footer', group: 'checked',
    html: page('<header><a href="/1">Kopf</a></header><footer><div><a href="/2">Impressum</a></div></footer><div role="contentinfo"><a href="/3">Datenschutz</a></div><div class="site-footer"><a href="/4">AGB</a></div><div id="Footer-Bereich"><a href="/5">Kontakt</a></div><div class="page-wrapper has-footer"><header>H</header><a href="/6">Seite</a></div><div class="footer"><main>M</main><a href="/7">Main</a></div><div role="CONTENTINFO"><a href="/8">Gross</a></div>'),
    chromium: { title: '', lang: 'de', text: 'Kopf\nImpressum\nDatenschutz\nAGB\nKontakt\nH\nSeite\nM\nMain\nGross', links: [['https://edge.example/1', 'Kopf'], ['https://edge.example/2', 'Impressum', true], ['https://edge.example/3', 'Datenschutz', true], ['https://edge.example/4', 'AGB', true], ['https://edge.example/5', 'Kontakt', true], ['https://edge.example/6', 'Seite'], ['https://edge.example/7', 'Main'], ['https://edge.example/8', 'Gross']] } },
  { name: 'ex-attr-gt', group: 'checked',
    html: page('<a title="a > b" data-x=\'"\' href="/q" href="/zweites">Q</a><a href=/unquoted?a=1&copy=2&amp;b=3>U</a>'),
    chromium: { title: '', lang: 'de', text: 'QU', links: [['https://edge.example/q', 'Q'], ['https://edge.example/unquoted?a=1&copy=2&b=3', 'U']] } },
  { name: 'ex-quirks', group: 'checked',
    html: '<html><body class="WooCommerce-JS"><script ID="WP-Emoji-Settings"></script></body></html>',
    chromium: { title: '', lang: null, text: '', links: [], selectors: ['script#wp-emoji-settings', 'body.woocommerce-js, body.woocommerce-no-js'] } },
  { name: 'opt-label-empty-text', group: 'fixed',
    html: page('<p><select><option label="L"></option><option label="M">  </option></select></p>'),
    chromium: { title: '', lang: 'de', text: '', links: [] } },
  { name: 'svg-hidden-attr', group: 'checked',
    html: page('<p>vor <svg hidden width="10" height="10"></svg> nach</p>'),
    chromium: { title: '', lang: 'de', text: 'vor  nach', links: [] } },
  { name: 'svg-sprite-start', group: 'fixed',
    html: page('<svg style="display:none"><symbol id="i"><path d="M0"/></symbol></svg> <p>Text <svg style="display:none"></svg> mehr</p>'),
    chromium: { title: '', lang: 'de', text: 'Text mehr', links: [] } },
  { name: 'svg-visibility', group: 'checked',
    html: page('<p>vor <svg width="10" height="10" style="visibility:hidden"></svg> nach</p>'),
    chromium: { title: '', lang: 'de', text: 'vor  nach', links: [] } },
  { name: 'img-block', group: 'fixed',
    html: page('<p>a<img style="display:block" src="x.png" alt="">b</p>'),
    chromium: { title: '', lang: 'de', text: 'a\nb', links: [] } },
  { name: 'svg-block', group: 'fixed',
    html: page('<p>a<svg style="display:block" width="5" height="5"></svg>b</p>'),
    chromium: { title: '', lang: 'de', text: 'a\nb', links: [] } },
  { name: 'img-flex', group: 'fixed',
    html: page('<div style="display:flex">a<img src="x.png" alt="">b</div>'),
    chromium: { title: '', lang: 'de', text: 'a\nb', links: [] } },
  { name: 'svg-flex', group: 'fixed',
    html: page('<div style="display:flex">a<svg width="5" height="5"></svg>b</div>'),
    chromium: { title: '', lang: 'de', text: 'a\nb', links: [] } },
  { name: 'svg-float', group: 'fixed',
    html: page('<p>a<svg style="float:left" width="5" height="5"></svg>b</p>'),
    chromium: { title: '', lang: 'de', text: 'a\nb', links: [] } },
  { name: 'p-ib-spaces', group: 'fixed',
    html: page('<div>a <p style="display:inline-block">b</p> c</div>'),
    chromium: { title: '', lang: 'de', text: 'a \n\nb\n\n c', links: [] } },
  { name: 'script-string-end', group: 'checked',
    html: page('<p>vor</p><script>var s = "</script><p>mitte</p>";</script><p>nach</p>'),
    chromium: { title: '', lang: 'de', text: 'vor\n\nmitte\n\n";\n\nnach', links: [] } },
  { name: 'script-comment-no-dashes', group: 'fixed',
    html: page('<p>vor</p><script><!-- x <script> y --!> z </script> w</script><p>nach</p>'),
    chromium: { title: '', lang: 'de', text: 'vor\n\nnach', links: [] } },
  { name: 'script-upper', group: 'fixed',
    html: page('<p>vor</p><SCRIPT><!-- <SCRIPT>a</SCRIPT> --></SCRIPT><p>nach</p>'),
    chromium: { title: '', lang: 'de', text: 'vor\n\nnach', links: [] } },
  { name: 'script-escape-dashes', group: 'fixed',
    html: page('<p>vor</p><script><!-- <script>a</script --> b </script>c<p>nach</p>'),
    chromium: { title: '', lang: 'de', text: 'vor\n\nc\n\nnach', links: [] } },
  { name: 'script-double-dash-gt', group: 'checked',
    html: page('<p>vor</p><script><!--<script>a--></script>b<p>nach</p>'),
    chromium: { title: '', lang: 'de', text: 'vor\n\nb\n\nnach', links: [] } },
  { name: 'nav-inline-li', group: 'checked',
    html: doc('<ul><li style="display:inline"><a href="/">Start</a></li> <li style="display:inline"><a href="/impressum">Impressum</a></li></ul><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'Start Impressum\n\nx', links: [['https://edge.example/', 'Start'], ['https://edge.example/impressum', 'Impressum']] } },
  { name: 'nav-flex-ul', group: 'checked',
    html: doc('<ul style="display:flex"><li><a href="/">Start</a></li><li><a href="/impressum">Impressum</a></li></ul>'),
    chromium: { title: 'T', lang: 'de', text: 'Start\nImpressum', links: [['https://edge.example/', 'Start'], ['https://edge.example/impressum', 'Impressum']] } },
  { name: 'nav-float-li', group: 'checked',
    html: doc('<ul><li style="float:left"><a href="/">Start</a></li><li style="float:left"><a href="/i">Impressum</a></li></ul><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'Start\nImpressum\n\nx', links: [['https://edge.example/', 'Start'], ['https://edge.example/i', 'Impressum']] } },
  { name: 'div-table', group: 'fixed',
    html: doc('<div style="display:table"><div style="display:table-row"><div style="display:table-cell">Firma</div><div style="display:table-cell">Muster GmbH</div></div><div style="display:table-row"><div style="display:table-cell">HRB</div><div style="display:table-cell">98765</div></div></div>'),
    chromium: { title: 'T', lang: 'de', text: 'Firma\tMuster GmbH\nHRB\t98765', links: [] } },
  { name: 'td-blocks', group: 'checked',
    html: doc('<table><tr><td><p>Muster GmbH</p><p>Bohnenweg 7<br>54321 Kaffeestadt</p></td><td>rechts</td></tr></table>'),
    chromium: { title: 'T', lang: 'de', text: 'Muster GmbH\n\nBohnenweg 7\n54321 Kaffeestadt\n\n\trechts', links: [] } },
  { name: 'pre-in-p', group: 'checked',
    html: doc('<p>vor<pre>\n a  b\n</pre>nach</p>'),
    chromium: { title: 'T', lang: 'de', text: 'vor\n\n a  b\n\nnach', links: [] } },
  { name: 'ws-mix', group: 'checked',
    html: doc('<p>a\u00a0 \t b&nbsp;&nbsp;c <b> </b> d\u200be <span>\n</span>f</p><p> \u00a0x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a\u00a0 b\u00a0\u00a0c d\u200be f\n\n\u00a0x', links: [] } },
  { name: 'transform-cap', group: 'known', known: 'text-transform: capitalize is not applied (uppercase and lowercase are)',
    html: doc('<p style="text-transform:capitalize">muster rösterei gmbh</p><p style="white-space:nowrap">a    b</p>'),
    chromium: { title: 'T', lang: 'de', text: 'Muster Rösterei Gmbh\n\na b', links: [] } },
  { name: 'misc-inline', group: 'checked',
    html: doc('<p><font color="red">rot</font> <nobr>kein umbruch</nobr> <center>mitte</center><marquee>lauf</marquee> <address>Adresse 1</address>ende</p>'),
    chromium: { title: 'T', lang: 'de', text: 'rot kein umbruch\n\nmitte\nlauf\nAdresse 1\nende', links: [] } },
  { name: 'hr-legend', group: 'checked',
    html: doc('<div>a<hr>b</div><fieldset><legend>Titel</legend>Inhalt</fieldset><label>Name</label>'),
    chromium: { title: 'T', lang: 'de', text: 'a\nb\nTitel\nInhalt\nName', links: [] } },
  { name: 'ruby', group: 'checked',
    html: doc('<p><ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby> x</p>'),
    chromium: { title: 'T', lang: 'de', text: '漢kan x', links: [] } },
  { name: 'iframe-fallback', group: 'checked',
    html: doc('<p>a<iframe src="/none.html"><a href="/x">Fallback</a></iframe>b</p>'),
    chromium: { title: 'T', lang: 'de', text: 'ab', links: [] } },
  { name: 'noscript-head', group: 'checked',
    html: '<!doctype html><html><head><noscript><a href="/n">n</a><style>p{}</style></noscript><title>T</title></head><body><p>x</p></body></html>',
    chromium: { title: 'T', lang: null, text: 'x', links: [] } },
  { name: 'after-body', group: 'checked',
    html: '<!doctype html><html><head><title>T</title></head><body><p>a</p></body>Text nach body<p>p</p></html><p>nach html</p><!-- c -->',
    chromium: { title: 'T', lang: null, text: 'a\n\nText nach body\n\np\n\nnach html', links: [] } },
  { name: 'text-comment-chain', group: 'checked',
    html: doc('<p>a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!---->a<!----></p>'),
    chromium: { title: 'T', lang: 'de', text: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', links: [] } },
  { name: 'details-nested', group: 'fixed',
    html: doc('<details open><summary>A</summary><details><summary>B</summary><a href="/x">tief</a></details>sichtbar</details>'),
    chromium: { title: 'T', lang: 'de', text: 'A\nB\nsichtbar', links: [['https://edge.example/x', '']] } },
  { name: 'dialog-open', group: 'checked',
    html: doc('<dialog open><p>Offen</p></dialog><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'Offen\n\nx', links: [] } },
  { name: 'heading-br', group: 'checked',
    html: doc('<h2>Kontakt<br>und mehr</h2><dl><dt>Tel</dt><dd>0123</dd></dl>'),
    chromium: { title: 'T', lang: 'de', text: 'Kontakt\nund mehr\nTel\n0123', links: [] } },
  { name: 'empty-blocks', group: 'checked',
    html: doc('<div>a</div><div></div><div> </div><p></p><div>b</div>'),
    chromium: { title: 'T', lang: 'de', text: 'a\n\nb', links: [] } },
  { name: 'inline-block-br', group: 'checked',
    html: doc('<p>a <span style="display:inline-block">b<br>c </span> d</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a b\nc d', links: [] } },
  { name: 'abs-pos', group: 'checked',
    html: doc('<p>a<span style="position:absolute">b</span>c<span style="position:fixed">d</span>e</p>'),
    chromium: { title: 'T', lang: 'de', text: 'a\nb\nc\nd\ne', links: [] } },
  { name: 'link-only-hidden-text', group: 'checked',
    html: doc('<a href="/x"><span style="display:none">Impressum</span></a><a href="/y" aria-label="Z"><span style="visibility:hidden">V</span></a>'),
    chromium: { title: 'T', lang: 'de', text: '', links: [['https://edge.example/x', ''], ['https://edge.example/y', 'Z']] } },
  { name: 'entities-known', group: 'fixed',
    html: doc('<p>&notin; &timesb; &copysr; &parallel; &ltimes; &gtrless; &notinva; &Uuml &Uuml; &uuml &sup2; &frac12 &notit; &copy2026 &centerdot;</p>'),
    chromium: { title: 'T', lang: 'de', text: '∉ ⊠ ℗ ∥ ⋉ ≷ ∉ Ü Ü ü ² ½ ¬it; ©2026 ·', links: [] } },
  { name: 'entities-unknown', group: 'known', known: 'about 250 of the 2,231 named references are known; the others stay as written',
    html: doc('<p>&part; &ThinSpace; &dot; &bigstar;</p>'),
    chromium: { title: 'T', lang: 'de', text: '∂ \u2009 ˙ ★', links: [] } },
  { name: 'hidden-nested-links', group: 'checked',
    html: doc('<div hidden><a href="/a">A<table><tr><td><a href="/b">B</a></td></tr></table>C</a></div><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'x', links: [['https://edge.example/a', 'ABC'], ['https://edge.example/b', 'B']] } },
  { name: 'hidden-link-script-text', group: 'checked',
    html: doc('<div hidden><a href="/a">A<script>s</script><style>t</style>B</a></div><p>x</p>'),
    chromium: { title: 'T', lang: 'de', text: 'x', links: [['https://edge.example/a', 'AstB']] } },
  { name: 'body-not-rendered', group: 'checked',
    html: '<!doctype html><html style="display:none"><head><title>T</title></head><body><p>a</p>\n<a href="/x"> l </a><template>t</template></body></html>',
    chromium: { title: 'T', lang: null, text: 'a\n l ', links: [['https://edge.example/x', 'l']] } },
  { name: 'realistic-reopened', group: 'checked',
    html: doc('<p><a href="/x" class="btn">eins</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p><p>zwei</p>'),
    chromium: { title: 'T', lang: 'de', text: 'eins\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei\n\nzwei', links: [['https://edge.example/x', 'eins'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei'], ['https://edge.example/x', 'zwei']] } },
  { name: 'href-variants', group: 'checked',
    html: doc('<a href="  /impressum  ">1</a><a href="java\nscript:alert(1)">2</a><a href="//other.example/x">3</a><a href="?q=1">4</a><a href="#">5</a><a href="mailto:info&#64;muster.example">6</a><a href="tel:+49 123">7</a><a href="HTTPS://EXAMPLE.EXAMPLE/A">8</a><a href="http://[::1">9</a><a href="https://münchen.example/ä?ö=ü#ß">10</a><a href="data:text/html,x">12</a><a href="">leer</a>'),
    chromium: { title: 'T', lang: 'de', text: '1234567891012leer', links: [['https://edge.example/impressum', '1'], ['javascript:alert(1)', '2'], ['https://other.example/x', '3'], ['https://edge.example/href-variants.html?q=1', '4'], ['https://edge.example/href-variants.html#', '5'], ['mailto:info@muster.example', '6'], ['tel:+49 123', '7'], ['https://example.example/A', '8'], ['http://[::1', '9'], ['https://xn--mnchen-3ya.example/%C3%A4?%C3%B6=%C3%BC#%C3%9F', '10'], ['data:text/html,x', '12'], ['https://edge.example/href-variants.html', 'leer']] } },
  { name: 'href-unc', group: 'known', known: 'Chromium\'s URL parser reads "\\\\server\\x" as a Windows share (file://server/x); the WHATWG parser of the Worker gives https://server/x',
    html: doc('<a href="\\\\server\\x">unc</a>'),
    chromium: { title: 'T', lang: 'de', text: 'unc', links: [['file://server/x', 'unc']] } },
  { name: 'impressum-old-script', group: 'fixed',
    html: '<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><title>Impressum</title></head>\n<body>\n<h1>Impressum</h1>\n<p>Muster Rösterei GmbH<br>\n<script type="text/javascript"><!--\ndocument.write(\'<script src="/zaehler.js"></script>\');\n//--></script>\nBohnenweg 7<br>54321 Kaffeestadt</p>\n<p>E-Mail: info [at] muster-roesterei.example<br>Registergericht: Amtsgericht Musterburg, HRB 98765<br>USt-IdNr.: DE123456789</p>\n<details><summary>Rechtliches</summary><a href="/datenschutz">Datenschutzerklärung</a></details>\n<footer><a href="/impressum">Impressum</a></footer>\n</body></html>',
    chromium: { title: 'Impressum', lang: 'de', text: 'Impressum\n\nMuster Rösterei GmbH\nBohnenweg 7\n54321 Kaffeestadt\n\nE-Mail: info [at] muster-roesterei.example\nRegistergericht: Amtsgericht Musterburg, HRB 98765\nUSt-IdNr.: DE123456789\n\nRechtliches\nImpressum', links: [['https://edge.example/datenschutz', ''], ['https://edge.example/impressum', 'Impressum', true]] } },
];

describe('the quick snapshot against Chromium on synthetic edge pages', () => {
  it('has unique names and a reason for every known difference', () => {
    expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
    for (const c of CASES) expect(c.group === 'known', c.name).toBe(c.known !== undefined);
  });

  describe.each(['fixed', 'checked'] as const)('%s: gives what Chromium gives', (group) => {
    it.each(CASES.filter((c) => c.group === group).map((c) => [c.name, c] as const))('%s', (_name, c) => {
      expect(quickParts(quick(c))).toEqual(normalized(c.chromium));
    });
  });

  describe('known: still differs from Chromium for the stated reason', () => {
    it.each(CASES.filter((c) => c.group === 'known').map((c) => [`${c.name}: ${c.known ?? ''}`, c] as const))('%s', (_name, c) => {
      expect(quickParts(quick(c))).not.toEqual(normalized(c.chromium));
    });
  });

  it('an Impressum with an old document.write script and a closed <details> gives the browser text, links and fields', () => {
    const c = CASES.find((x) => x.name === 'impressum-old-script') as EdgeCase;
    const snap = quick(c);
    const browserLinks = c.chromium.links.map(([href, text, footer]) => ({ href, text, footer: footer === true }));
    expect(snap.text).toBe(c.chromium.text);
    expect(snap.links).toEqual(browserLinks);
    expect(extractImpressumFields(snap.text, snap.links)).toEqual(extractImpressumFields(c.chromium.text, browserLinks));
    // Before the fix the script ended at its inner "</script>": the text held "'); //-->" between the firm and the street.
    expect(snap.text).not.toContain('//-->');
  });
});

describe('charsets (Chromium checked)', () => {
  const latin = (s: string): number[] => [...s].map((c) => (c === '€' ? 0x80 : c === '–' ? 0x96 : c.charCodeAt(0)));
  const textOf = (bytes: number[], contentType: string): string => snapshotFromHtml(decodeHtml(Uint8Array.from(bytes), contentType), `${ORIGIN}/`).text;

  it('the header wins over <meta charset>', () => {
    expect(textOf(latin('<!doctype html><meta charset="utf-8"><p>Geschäftsführer</p>'), 'text/html; charset=ISO-8859-1')).toBe('Geschäftsführer');
  });

  it('ISO-8859-15 from the header: 0xA4 is the euro sign', () => {
    expect(textOf([...latin('<!doctype html><p>Preis 5 '), 0xa4, ...latin(' ok</p>')], 'text/html; charset=iso-8859-15')).toBe('Preis 5 € ok');
  });

  it('a meta charset in the first 1024 bytes counts even inside a script (the prescan of the standard)', () => {
    expect(textOf(latin(`<!doctype html><script>var s = '<meta charset="iso-8859-1">';</script><p>Geschäftsführer</p>`), 'text/html')).toBe('Geschäftsführer');
  });

  // Session fix-a4: when nothing in the header or the first 1024 bytes names a charset, the quick check reads valid
  // UTF-8 as UTF-8 and anything else as windows-1252. Chromium guesses a legacy encoding from the bytes and keeps
  // looking for <meta> while only head elements came; it never guesses UTF-8 and falls back to the browser's locale default.
  it('undeclared Latin-1 is read as windows-1252, as Chromium guessed: "Geschäftsführer: Jürgen Müller – 5 €"', () => {
    const text = textOf(latin('<!doctype html><html><head><title>Straße</title></head><body><p>Geschäftsführer: Jürgen Müller – 5 €</p></body></html>'), 'text/html');
    expect(text).toBe('Geschäftsführer: Jürgen Müller – 5 €');
  });

  it('a <meta http-equiv> after 1024 bytes of <head> is not seen, but the bytes are not UTF-8 and are read as windows-1252 (Chromium kept scanning the head: "Geschäftsführer")', () => {
    const head = `<!doctype html><html><head><title>T</title><style>${'p{color:red}'.repeat(120)}</style><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">`;
    expect(textOf(latin(`${head}</head><body><p>Geschäftsführer</p></body></html>`), 'text/html')).toBe('Geschäftsführer');
  });

  it('known: undeclared UTF-8 is read as UTF-8 (Chromium used its locale default, windows-1251 on the recording machine)', () => {
    const bytes = [...new TextEncoder().encode('<!doctype html><p>Geschäftsführer – 5 €</p>')];
    expect(textOf(bytes, 'text/html')).toBe('Geschäftsführer – 5 €');
  });
});

describe('limits that keep real pages exact', () => {
  it('1,500 long links and a legal word 60,000 characters into a later link: labels and the legal-word test are exact', () => {
    const filler = 'Kategorie '.repeat(100);
    const many = Array.from({ length: SNAPSHOT_MAX_LINKS }, (_, i) => `<a href="/k/${i}">${filler}${i}</a>`).join('');
    const late = `<a href="/spaeter">${'Wort '.repeat(12000)}Datenschutz</a>`;
    const snap = snapshotFromHtml(doc(`${many}${late}`), `${ORIGIN}/`);
    expect(snap.links).toHaveLength(SNAPSHOT_MAX_LINKS + 1);
    expect(snap.links[0]?.text).toBe(filler.slice(0, SNAPSHOT_LINK_TEXT_LENGTH));
    expect(snap.links[SNAPSHOT_MAX_LINKS]?.href).toBe(`${ORIGIN}/spaeter`);
  });

  it('a link left open in 1,000 paragraphs, with a long class, is reopened in every one', () => {
    const snap = snapshotFromHtml(doc(`<p><a href="/x" class="${'knopf '.repeat(60)}">eins</p>${'<p>weiter</p>'.repeat(1000)}`), `${ORIGIN}/`);
    expect(snap.links).toHaveLength(1001);
    expect(snap.links.every((l) => l.href === `${ORIGIN}/x`)).toBe(true);
  });

  it('<html> and <body> again: missing attributes are added, existing ones are kept', () => {
    const snap = snapshotFromHtml('<!doctype html><html lang="de"><body class="start"><p>x</p><html lang="en" data-a="1"><body class="woocommerce" id="k">', `${ORIGIN}/`, { platform: true });
    expect(snap.lang).toBe('de');
    expect(snap.platform?.selectors).toEqual([]);
  });
});

describe('CPU on hostile pages of 2 MB found by this review (each took 0.6 s to 183 s before the fixes)', () => {
  const MB2 = 2 * 1024 * 1024;
  const fill = (unit: string): string => unit.repeat(Math.ceil(MB2 / unit.length)).slice(0, MB2);
  const upTo = (prefix: string, next: (i: number) => string): string => {
    const parts = [prefix];
    let length = prefix.length;
    for (let i = 0; length < MB2; i += 1) {
      const part = next(i);
      parts.push(part);
      length += part.length;
    }
    return parts.join('').slice(0, MB2);
  };
  const attributes = (n: number): string => Array.from({ length: n }, (_, i) => `a${i}`).join(' ');
  const chains = (open: string, close: string, depth: number, text: string): string => {
    const chain = `${open.repeat(depth)}${text}${close.repeat(depth)}`;
    return `<body>${chain.repeat(Math.floor((MB2 - 6) / chain.length))}`;
  };
  const hostile: [string, () => string][] = [
    // 54 s before: every <body> tag merged its attribute by scanning all earlier ones.
    ['<body> again and again, each with a new attribute', () => upTo('<body>', (i) => `<body a${i}>`)],
    // 63 s before.
    ['<html> again and again, each with a new attribute', () => upTo('<p>x', (i) => `<html a${i}>`)],
    // 14.5 s before.
    ['two <body> tags with 90,000 attributes each', () => `<body ${attributes(90000)}><body ${attributes(90000)}>`],
    // 6.9 s before: every copy of the link scanned 60,000 attributes several times.
    ['a link with 60,000 attributes reopened in every paragraph', () => upTo(`<p><a href="/x" ${attributes(60000)}>t</p>`, () => '<p>t</p>')],
    // 183 s before: every copy parsed the 1 MB style again.
    ['a link with a 1 MB style reopened in every paragraph', () => upTo(`<p><a href="/x" style="${'a:b;'.repeat(250000)}">t</p>`, () => '<p>t</p>')],
    // 1.7 s before: each hidden link walked its whole subtree for its textContent.
    ['256 nested hidden links around 500,000 empty elements', () => upTo(`<body>${'<a href="/x"><object>'.repeat(256)}`, () => '<br>')],
    // 0.8 s before: thousands of nested links each read 65,536 characters.
    ['nested hidden links with long text', () => chains('<a href="/x"><object>', '</object></a>', 250, 'Wort '.repeat(14000))],
    ['nested rendered links in table cells with long text', () => chains('<a href="/x"><table><tr><td>', '</td></tr></table></a>', 125, 'W'.repeat(8300))],
    ['script escape states with many "<" and "-"', () => `<script><!--<script>${fill('</scrip <!-- --x -> <script </script- <')}`],
    ['many scripts that open and close escapes', () => fill('<script><!--<script></script>--></script>')],
    ['a closed <details> around 2 MB of links', () => `<details><summary>s</summary>${fill('<a href="/x">t</a>')}`],
    ['rows made with display: table-row', () => `<div style="display:table">${fill('<div style="display:table-row"><div style="display:table-cell">c</div></div>')}`],
    ['a table with a row group per row', () => `<table>${fill('<tbody><tr><td>x')}`],
  ];

  it.each(hostile)('%s', (_name, make) => {
    const html = make();
    expect(html.length).toBeGreaterThanOrEqual(MB2 / 2);
    // Session fix-a6 (review finding 97): the limit is 1 s, or four times what an ordinary page of the same size takes
    // right before. The whole suite runs in parallel, and on a busy laptop a page can take three times longer for a
    // moment, so a try over the limit is repeated up to twice and the fastest try counts. A super-linear case (seconds
    // to minutes before the fixes of the review) fails every try.
    const ordinary = fill('<p>Willkommen bei der Beispiel GmbH. <a href="/impressum">Impressum</a></p>');
    const timed = (input: string) => {
      const started = performance.now();
      const result = snapshotFromHtml(input, `${ORIGIN}/`, { platform: true });
      return { result, ms: performance.now() - started };
    };
    let best = { ms: Number.POSITIVE_INFINITY, limit: 1000 };
    let snap = null as ReturnType<typeof snapshotFromHtml> | null;
    for (let attempt = 0; attempt < 3 && best.ms >= best.limit; attempt += 1) {
      const limit = Math.max(1000, 4 * timed(ordinary).ms);
      const run = timed(html);
      snap = run.result;
      if (run.ms - limit < best.ms - best.limit) best = { ms: run.ms, limit };
    }
    expect(snap).not.toBeNull();
    expect(best.ms, `${Math.round(best.ms)} ms, limit ${Math.round(best.limit)} ms`).toBeLessThan(best.limit);
  });
});
