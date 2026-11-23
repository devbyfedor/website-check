import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPRESSUM_SNAPSHOT_EXPRESSION, SNAPSHOT_EXPRESSION } from '../src/capture/page-scripts.ts';
import type { PageLink } from '../src/capture/types.ts';
import { extractImpressumFields } from '../src/legal/fields.ts';
import { PLATFORM_SELECTORS } from '../src/platform/fingerprints.ts';
import {
  decodeHtml,
  decodeWindows1252,
  SNAPSHOT_GENERATOR_LENGTH,
  SNAPSHOT_LEGAL_WORDS,
  SNAPSHOT_LINK_TEXT_LENGTH,
  SNAPSHOT_MAX_EXTRA_LINKS,
  SNAPSHOT_MAX_GENERATORS,
  SNAPSHOT_MAX_LINKS,
  SNAPSHOT_MAX_TEXT,
  SNAPSHOT_META_LENGTH,
  snapshotFromHtml,
  staticSelectorSupported,
} from '../src/quick/html-snapshot.ts';
import { SCANNER_ROOT } from './helpers.ts';

/**
 * Session A5 part 3: the quick check reads the HTML without a browser and must give the same snapshot as
 * the in-page scripts. Synthetic pages only (invented firms, `.example` domains), no network.
 */

const PAGE = 'https://www.muster-roesterei.example/start/seite.html';
const page = (body: string, head = ''): string => `<!doctype html><html lang="de"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const textOf = (body: string): string => snapshotFromHtml(page(body), PAGE).text;
const linksOf = (body: string, head = ''): PageLink[] => snapshotFromHtml(page(body, head), PAGE).links;
const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...new TextEncoder().encode(part)] : part)));

describe('the caps and rules of the in-page script', () => {
  it.each([
    ['SNAPSHOT_EXPRESSION', SNAPSHOT_EXPRESSION],
    ['IMPRESSUM_SNAPSHOT_EXPRESSION', IMPRESSUM_SNAPSHOT_EXPRESSION],
  ])('%s uses the same numbers and rules', (_name, script) => {
    expect(script).toContain(`const MAX_TEXT = ${SNAPSHOT_MAX_TEXT};`);
    expect(script).toContain(`const MAX_LINKS = ${SNAPSHOT_MAX_LINKS};`);
    expect(script).toContain(`const MAX_EXTRA_LINKS = ${SNAPSHOT_MAX_EXTRA_LINKS};`);
    expect(script).toContain(`const legal = /${SNAPSHOT_LEGAL_WORDS}/i;`);
    expect(script).toContain(`.replace(/\\s+/g, ' ').trim().slice(0, ${SNAPSHOT_LINK_TEXT_LENGTH})`);
    expect(script).toContain("(a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '')");
    expect(script).toContain("document.querySelectorAll('a[href]')");
    expect(script).toContain('new URL(raw, document.baseURI).href');
    expect(script).toContain("tag === 'footer' || el.getAttribute('role') === 'contentinfo'");
    expect(script).toContain(`el.querySelector('header, main, [role="main"], [role="banner"]')`);
    expect(script).toContain("names.indexOf('footer') !== -1 && tag !== 'body' && tag !== 'html'");
    expect(script).toContain('url: location.href');
    expect(script).toContain("document.documentElement.getAttribute('lang')");
    expect(script).toContain("const text = body ? (body.innerText || '') : '';");
  });

  it('the homepage script reads the generator and security meta tags as the quick check does', () => {
    expect(SNAPSHOT_EXPRESSION).toContain(`querySelectorAll('meta[name="generator" i]')).slice(0, ${SNAPSHOT_MAX_GENERATORS})`);
    expect(SNAPSHOT_EXPRESSION).toContain(`.slice(0, ${SNAPSHOT_GENERATOR_LENGTH})`);
    expect(SNAPSHOT_EXPRESSION).toContain(`.slice(0, ${SNAPSHOT_META_LENGTH})`);
    expect(SNAPSHOT_EXPRESSION).toContain(`read('meta[http-equiv="content-security-policy" i]')`);
    expect(SNAPSHOT_EXPRESSION).toContain(`read('meta[name="referrer" i]')`);
  });
});

describe('decodeHtml', () => {
  it('reads UTF-8 by default', () => {
    expect(decodeHtml(bytes('<p>Grüße aus München</p>'), undefined)).toBe('<p>Grüße aus München</p>');
    expect(decodeHtml(bytes('<p>Grüße</p>'), 'text/html')).toBe('<p>Grüße</p>');
  });

  it('takes the charset of the Content-Type header and reads ISO-8859-1 as windows-1252', () => {
    expect(decodeHtml(bytes('Stra', [0xdf], 'e ', [0x80], ' ', [0x96], ' ', [0xe4]), 'text/html; charset=ISO-8859-1')).toBe('Straße € – ä');
    expect(decodeHtml(bytes([0xe4]), 'text/html;charset="windows-1252"')).toBe('ä');
    expect(decodeHtml(bytes([0xe4]), 'text/html; foo=bar; charset=latin1')).toBe('ä');
  });

  it('a byte order mark wins over the header', () => {
    expect(decodeHtml(bytes([0xef, 0xbb, 0xbf], 'Grüße'), 'text/html; charset=iso-8859-1')).toBe('Grüße');
    expect(decodeHtml(Uint8Array.from([0xff, 0xfe, 0x41, 0x00, 0xe4, 0x00]), null)).toBe('Aä');
    expect(decodeHtml(Uint8Array.from([0xfe, 0xff, 0x00, 0x41, 0x00, 0xe4]), null)).toBe('Aä');
  });

  it('finds <meta charset> and <meta http-equiv> in the first 1024 bytes', () => {
    expect(decodeHtml(bytes('<html><head><meta charset="iso-8859-1"><title>', [0xc4], '</title>'), null)).toContain('<title>Ä</title>');
    expect(decodeHtml(bytes('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><p>', [0x80], '</p>'), undefined)).toContain('<p>€</p>');
    expect(decodeHtml(bytes("<META CHARSET='Latin1'>", [0xfc]), undefined)).toContain('ü');
  });

  it('ignores a meta tag after 1024 bytes, inside a comment, or without the pragma', () => {
    const late = bytes(`<!--${'x'.repeat(1100)}--><meta charset="iso-8859-1">`, [0xe4]);
    expect(decodeHtml(late, null).endsWith('\ufffd')).toBe(true);
    expect(decodeHtml(bytes('<!-- <meta charset="iso-8859-1"> -->', [0xe4]), null).endsWith('\ufffd')).toBe(true);
    expect(decodeHtml(bytes('<meta content="text/html; charset=iso-8859-1">', [0xe4]), null).endsWith('\ufffd')).toBe(true);
  });

  it('the header wins over the meta tag; an unknown label falls back to the next source', () => {
    expect(decodeHtml(bytes('<meta charset="iso-8859-1">Grüße'), 'text/html; charset=utf-8')).toContain('Grüße');
    expect(decodeHtml(bytes('<meta charset="iso-8859-1">', [0xe4]), 'text/html; charset=nonsense-42')).toContain('ä');
    // A meta tag that names UTF-16 means UTF-8 (the bytes are ASCII-compatible if the tag could be read).
    expect(decodeHtml(bytes('<meta charset="utf-16">Grüße'), null)).toContain('Grüße');
  });

  it('decodes windows-1252 by hand exactly as the WHATWG table', () => {
    const all = decodeWindows1252(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(all.length).toBe(256);
    expect(all[0x41]).toBe('A');
    expect(all[0x80]).toBe('€');
    expect(all[0x81]).toBe('\u0081');
    expect(all[0x8a]).toBe('Š');
    expect(all[0x93]).toBe('“');
    expect(all[0x9f]).toBe('Ÿ');
    expect(all[0xa0]).toBe('\u00a0');
    expect(all[0xe4]).toBe('ä');
    expect(all).toBe(new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i)));
  });

  it('never throws on invalid bytes', () => {
    expect(decodeHtml(Uint8Array.from([0x41, 0xff, 0xfe, 0x42].slice(0, 4)), 'text/html; charset=utf-8')).toBe('A\ufffd\ufffdB');
  });
});

describe('title and language', () => {
  it('reads the first HTML title with collapsed white space, and <html lang>', () => {
    const snap = snapshotFromHtml('<!doctype html><HTML LANG="de-DE"><head><title>\n  Impressum &ndash;\n Muster&nbsp;Rösterei  </title><title>Zweiter</title></head><body></body></html>', PAGE);
    expect(snap.title).toBe('Impressum – Muster\u00a0Rösterei');
    expect(snap.lang).toBe('de-DE');
  });

  it('an SVG title does not count; a title in the body does; no title gives ""; no lang gives null', () => {
    expect(snapshotFromHtml('<body><svg><title>Icon</title></svg><title>Seite</title></body>', PAGE).title).toBe('Seite');
    const empty = snapshotFromHtml('<p>Hallo</p>', PAGE);
    expect(empty.title).toBe('');
    expect(empty.lang).toBeNull();
  });

  it('the title is raw text: tags inside it stay text', () => {
    expect(snapshotFromHtml('<title>a <b>fett</b> &amp; b</title><p>x</p>', PAGE).title).toBe('a <b>fett</b> & b');
  });

  it('url is the document address as location.href gives it', () => {
    expect(snapshotFromHtml('<p>x</p>', 'https://WWW.Muster-Roesterei.example').url).toBe('https://www.muster-roesterei.example/');
  });
});

describe('visible text (innerText)', () => {
  it('puts line breaks around blocks, two around paragraphs, and one for <br>', () => {
    expect(textOf('<h1>Impressum</h1><p>Muster Rösterei GmbH<br>\nBohnenweg 7<br>54321 Kaffeestadt</p><div>Kontakt</div><div><div>innen</div></div>')).toBe(
      'Impressum\n\nMuster Rösterei GmbH\nBohnenweg 7\n54321 Kaffeestadt\n\nKontakt\ninnen',
    );
  });

  it('collapses white space and removes it at the start and end of lines, also across inline elements', () => {
    expect(textOf('<p>   Kaffee    <b>  und </b>   Kuchen  </p>\n\n  <div>\n  Ende <br>  neu  </div>')).toBe('Kaffee und Kuchen\n\nEnde\nneu');
  });

  it('keeps a space next to an image or another atomic inline', () => {
    expect(textOf('<p><img src="logo.png" alt="Logo"> Text</p>')).toBe(' Text');
    expect(textOf('<p>a <span style="display:inline-block">  b  </span> c</p>')).toBe('a b c');
    expect(textOf('<p>Feld: <input value="geheim"> Ende</p>')).toBe('Feld:  Ende');
  });

  it('separates table cells by tabs and rows by line feeds, and closes unclosed cells, rows, items and paragraphs', () => {
    expect(textOf('<table><tr><td>Firma<td>Muster Rösterei GmbH<tr><th>HRB<td>98765</table><p>a<p>b<ul><li>eins<li>zwei</ul>')).toBe(
      'Firma\tMuster Rösterei GmbH\nHRB\t98765\n\na\n\nb\n\neins\nzwei',
    );
    expect(textOf('<table><tbody><tr><td>a</td><td></td></tr></tbody><tfoot><tr><td>c</td></tr></tfoot></table>')).toBe('a\t\nc');
  });

  it('keeps white space in <pre> and drops the newline right after the start tag', () => {
    expect(textOf('<pre>\n  Zeile 1\n    Zeile 2</pre><div>x</div>')).toBe('  Zeile 1\n    Zeile 2\nx');
    expect(textOf('<p style="white-space: pre-line">  a   b  \n  c</p>')).toBe('a b\nc');
  });

  it('decodes named, numeric and legacy references; unknown ones stay; nbsp and soft hyphen stay', () => {
    expect(textOf('<p>Gr&uuml;&szlig;e &amp; mehr&nbsp;Text &#8211; &#x2014; &euro; &copy 2026 &auml; &#150; &#64;&commat; &foo; &amp;x Stra&shy;ße</p>')).toBe(
      'Grüße & mehr\u00a0Text – — € © 2026 ä – @@ &foo; &x Stra\u00adße',
    );
  });

  it('leaves out hidden content, scripts, styles, noscript, templates, form values and SVG text', () => {
    expect(
      textOf(
        '<p>a<span hidden>B</span>c<span style="display: none !important">D</span>e<span style="visibility:hidden">F</span>g</p>' +
          '<script>var h = "<p>H</p>";</script><style>p{}</style><noscript><p>Bitte JavaScript</p></noscript><template><p>T</p></template>' +
          '<textarea>Notiz</textarea><svg><text>Grafik</text></svg><dialog><p>Dialog</p></dialog><input type="hidden" value="x">',
      ),
    ).toBe('aceg');
  });

  it('shows only the summary of a closed <details>, everything of an open one', () => {
    expect(textOf('<details><summary>Mehr</summary><p>Versteckt</p></details>')).toBe('Mehr');
    expect(textOf('<details open><summary>Mehr</summary><p>Sichtbar</p></details>')).toBe('Mehr\n\nSichtbar');
  });

  it('follows display, visibility, float and flex in the style attribute', () => {
    expect(textOf('<p>a<span style="display:block">b</span>c</p>')).toBe('a\nb\nc');
    expect(textOf('<div style="display:flex"><a href="/1">Eins</a> <a href="/2">Zwei</a> Text </div>')).toBe('Eins\nZwei\nText');
    expect(textOf('<div style="visibility:hidden">x<span style="visibility:visible">sichtbar</span></div>')).toBe('sichtbar');
    expect(textOf('<p>a<span style="float:left">b</span>c</p>')).toBe('a\nb\nc');
    expect(textOf('<p style="text-transform:uppercase">laut</p>')).toBe('LAUT');
  });

  it('puts every option of a select on its own line', () => {
    expect(textOf('<p>Land: <select><option>Deutschland</option><option label="AT">Österreich</select> Ende</p>')).toBe('Land: \nDeutschland\nAT\n Ende');
  });

  it('is tolerant: comments, doctype, stray "<", uppercase tags, unquoted attributes, CDATA in HTML', () => {
    // In HTML content "<![CDATA[" starts a bogus comment that ends at the first ">".
    expect(textOf('<!-- <p>kommentar</p> --><P>1 < 2 und 3 <4 <!---->x</P><!--->y<![CDATA[z]]>w')).toBe('1 < 2 und 3 <4 x\n\nyw');
    expect(textOf('<div>a<!-- unclosed comment <p>b</p>')).toBe('a');
    expect(textOf('<p>a</p></p><p>b')).toBe('a\n\nb');
  });

  it('reads raw text elements without parsing tags inside them', () => {
    const snap = snapshotFromHtml(page('<script>document.write("<a href=\\"/js\\">x</a></scr" + "ipt>")</script><textarea><a href="/ta">y</a></textarea><p>sichtbar</p>'), PAGE);
    expect(snap.links).toEqual([]);
    expect(snap.text).toBe('sichtbar');
  });

  it('when the body is not rendered, innerText is its textContent', () => {
    expect(snapshotFromHtml('<body hidden><p>a</p>\n<p>b</p><script>c</script></body>', PAGE).text).toBe('a\nbc');
  });

  it('caps the text at 100,000 characters', () => {
    const snap = snapshotFromHtml(page(`<p>${'Kaffee '.repeat(20000)}</p>`), PAGE);
    expect(snap.text.length).toBe(SNAPSHOT_MAX_TEXT);
    expect(snap.textTruncated).toBe(true);
    expect(snapshotFromHtml(page('<p>kurz</p>'), PAGE).textTruncated).toBe(false);
  });
});

describe('links', () => {
  it('resolves addresses against the document, keeps mailto and javascript, and keeps an address that does not parse', () => {
    expect(linksOf('<a href="../impressum.html">Impressum</a><a href="mailto:info@muster-roesterei.example">E-Mail</a><a href="javascript:void(0)">JS</a><a href="http://exa mple.example/">kaputt</a><a href="">leer</a><a href="#oben">Oben</a>')).toEqual([
      { href: 'https://www.muster-roesterei.example/impressum.html', text: 'Impressum', footer: false },
      { href: 'mailto:info@muster-roesterei.example', text: 'E-Mail', footer: false },
      { href: 'javascript:void(0)', text: 'JS', footer: false },
      { href: 'http://exa mple.example/', text: 'kaputt', footer: false },
      { href: PAGE, text: 'leer', footer: false },
      { href: `${PAGE}#oben`, text: 'Oben', footer: false },
    ]);
  });

  it('uses the first <base href>, resolved against the document; a javascript: base is ignored', () => {
    expect(linksOf('<a href="seite">x</a>', '<base href="/unter/"><base href="https://anders.example/">')[0]?.href).toBe('https://www.muster-roesterei.example/unter/seite');
    expect(linksOf('<base href="https://cdn.muster-roesterei.example/"><a href="seite">x</a>')[0]?.href).toBe('https://cdn.muster-roesterei.example/seite');
    expect(linksOf('<a href="seite">x</a>', '<base href="javascript:alert(1)">')[0]?.href).toBe('https://www.muster-roesterei.example/start/seite');
  });

  it('ignores <a> without href and links in comments, templates and raw text', () => {
    expect(linksOf('<a name="x">Anker</a><!-- <a href="/c">c</a> --><template><a href="/t">t</a></template><noscript><a href="/n">n</a></noscript><a HREF=/ok>OK</a>')).toEqual([
      { href: 'https://www.muster-roesterei.example/ok', text: 'OK', footer: false },
    ]);
  });

  it('takes the visible text, then aria-label, then title; collapses white space; at most 200 characters', () => {
    const long = 'Wort '.repeat(60);
    expect(
      linksOf(
        `<a href="/1">  Impressum\n  &amp;   Datenschutz </a><a href="/2" aria-label="Impressum"><img src="i.svg" alt="Impressum"></a><a href="/3" title="Datenschutz"><svg></svg></a>` +
          `<a href="/4"><img src="x.png" alt=""></a><a href="/5">${long}</a><a href="/6"><span aria-hidden="true">§</span> <span>IMPRESSUM</span></a><a href="/7">Kon<br>takt</a>`,
      ).map((l) => l.text),
    ).toEqual(['Impressum & Datenschutz', 'Impressum', 'Datenschutz', '', long.trim().slice(0, 200), '§ IMPRESSUM', 'Kon takt']);
  });

  it('a hidden link gives its textContent, as innerText does for an element that is not rendered', () => {
    expect(linksOf('<div hidden><a href="/x"> Ver<br>steckt  <span>Link</span></a></div><a href="/y" style="display:none">Auch<script>s</script></a>').map((l) => l.text)).toEqual([
      'Versteckt Link',
      'Auchs',
    ]);
  });

  it('an SVG link has no innerText: aria-label or title only', () => {
    expect(linksOf('<svg><a href="/svg" aria-label="Karte"><text>Text</text></a></svg>')).toEqual([{ href: 'https://www.muster-roesterei.example/svg', text: 'Karte', footer: false }]);
  });

  it('a link left open is reopened as the browser does', () => {
    expect(linksOf('<p><a href="/x">eins</p><p>zwei</p>').map((l) => [l.href.slice(-2), l.text])).toEqual([
      ['/x', 'eins'],
      ['/x', 'zwei'],
    ]);
    expect(linksOf('<a href="/a">A<a href="/b">B</a>').map((l) => l.text)).toEqual(['A', 'B']);
    expect(linksOf('<ul><li><a href="/1">Eins</li><li><a href="/2">Zwei</a></li></ul>').map((l) => l.text)).toEqual(['Eins', 'Zwei']);
  });

  it('marks footer links: <footer>, role="contentinfo", an id or class that names a footer without a header or main part', () => {
    const flags = linksOf(
      '<header><a href="/1">Kopf</a></header>' +
        '<footer><div><a href="/2">Impressum</a></div></footer>' +
        '<div role="contentinfo"><a href="/3">Datenschutz</a></div>' +
        '<div class="site-footer"><a href="/4">AGB</a></div>' +
        '<div id="Footer-Bereich"><a href="/5">Kontakt</a></div>' +
        '<div class="page-wrapper has-footer"><header>H</header><a href="/6">Seite</a></div>' +
        '<div class="footer"><main>M</main><a href="/7">Main</a></div>' +
        '<div role="CONTENTINFO"><a href="/8">Gross</a></div>',
    ).map((l) => l.footer);
    expect(flags).toEqual([false, true, true, true, true, false, false, false]);
    const body = snapshotFromHtml('<body class="footer-sticky"><a href="/x">x</a></body>', PAGE);
    expect(body.links[0]?.footer).toBe(false);
  });

  it('keeps 1,500 links and up to 100 more legal links after them', () => {
    const many = Array.from({ length: 1600 }, (_, i) => `<a href="/k/${i}">Kategorie ${i}</a>`).join(' ');
    const snap = snapshotFromHtml(page(`${many}<footer><a href="/impressum">Impressum</a><a href="/agb">AGB</a><a href="/x" aria-label="Datenschutz">i</a><a href="/barrierefreiheit">B</a></footer>`), PAGE);
    expect(snap.linksTruncated).toBe(true);
    expect(snap.links.length).toBe(SNAPSHOT_MAX_LINKS + 3);
    expect(snap.links.slice(SNAPSHOT_MAX_LINKS).map((l) => l.text)).toEqual(['Impressum', 'i', 'B']);
    const legal = Array.from({ length: 150 }, (_, i) => `<a href="/datenschutz/${i}">Datenschutz ${i}</a>`).join('');
    const capped = snapshotFromHtml(page(`${many}${legal}`), PAGE);
    expect(capped.links.length).toBe(SNAPSHOT_MAX_LINKS + SNAPSHOT_MAX_EXTRA_LINKS);
    expect(snapshotFromHtml(page('<a href="/1">1</a>'), PAGE).linksTruncated).toBe(false);
  });

  it('tolerates attribute values with ">" and quotes, and duplicate attributes (the first wins)', () => {
    expect(linksOf(`<a title="a > b" data-x='"' href="/q" href="/zweites">Q</a><a href=/unquoted?a=1&copy=2&amp;b=3>U</a>`).map((l) => l.href)).toEqual([
      'https://www.muster-roesterei.example/q',
      'https://www.muster-roesterei.example/unquoted?a=1&copy=2&b=3',
    ]);
  });
});

describe('security meta tags', () => {
  it('reads the first CSP and referrer meta tag, names compared without case, content cut at 1000 characters', () => {
    const snap = snapshotFromHtml(
      page('', `<meta http-equiv="Content-Security-Policy" content="default-src 'self'"><meta http-equiv="content-security-policy" content="zweite"><meta name="Referrer" content="${'x'.repeat(1200)}">`),
      PAGE,
    );
    expect(snap.securityMeta?.csp).toBe("default-src 'self'");
    expect(snap.securityMeta?.referrer).toBe('x'.repeat(1000));
  });

  it('gives null without the tag and "" for a tag without content', () => {
    expect(snapshotFromHtml(page('', '<meta name="referrer">'), PAGE).securityMeta).toEqual({ csp: null, referrer: '' });
  });
});

describe('system hints', () => {
  it('reads at most five generator meta tags of at most 120 characters; globals are always empty', () => {
    const head = ['WordPress 6.8.3', 'WooCommerce 10.2', 'Site Kit', 'Elementor', 'Yoast', 'Sechster', 'x'.repeat(200)]
      .map((g, i) => `<meta name="${i === 1 ? 'GENERATOR' : 'generator'}" content="${g}">`)
      .join('');
    const snap = snapshotFromHtml(page('', head + `<meta name="generator" content="${'y'.repeat(200)}">`), PAGE, { platform: true });
    expect(snap.platform?.generators).toEqual(['WordPress 6.8.3', 'WooCommerce 10.2', 'Site Kit', 'Elementor', 'Yoast']);
    expect(snap.platform?.globals).toEqual([]);
    const long = snapshotFromHtml(page('', `<meta name="generator" content="${'y'.repeat(200)}">`), PAGE, { platform: true });
    expect(long.platform?.generators).toEqual(['y'.repeat(120)]);
    expect(snapshotFromHtml(page(''), PAGE).platform).toBeUndefined();
  });

  it('every selector of the fingerprints is supported by the static matcher, so none is silently ignored', () => {
    expect(PLATFORM_SELECTORS.length).toBeGreaterThan(10);
    for (const selector of PLATFORM_SELECTORS) expect(staticSelectorSupported(selector), selector).toBe(true);
  });

  it('other selector syntaxes fail closed', () => {
    for (const selector of ['div p', 'ul > li', 'a + b', 'a ~ b', 'a:hover', 'a::before', '[ns|href]', '#a\\:b', '[x="a\\"b"]', '', ',', 'div,', '[href', '[="x"]', 'a!']) {
      expect(staticSelectorSupported(selector), selector).toBe(false);
    }
  });

  it('matches the fingerprint selectors on static HTML', () => {
    const wordpress = snapshotFromHtml(
      '<!doctype html><html><head><link rel="HTTPS://API.W.ORG/" href="/wp-json/"><style id="global-styles-inline-css"></style><script id="wp-emoji-settings" type="application/json">{}</script></head>' +
        '<body class="home woocommerce-no-js is-ctl-navigation"><div class="shopify-section" id="shopify-section-header"></div><ul class="menu cc-nav-level-0"></ul></body></html>',
      PAGE,
      { platform: true },
    );
    expect(wordpress.platform?.selectors).toEqual([
      'link[rel="https://api.w.org/"]',
      'style#global-styles-inline-css',
      'script#wp-emoji-settings',
      'body.woocommerce-js, body.woocommerce-no-js',
      'div.shopify-section[id^="shopify-section-"]',
      'body[class*="is-ctl-"]',
      'ul.cc-nav-level-0',
    ]);
    const shopware5 = snapshotFromHtml(
      '<!doctype html><body class="is--ctl-index"><div class="page-wrap--cookie-permission" data-cookie-permission="true"></div><meta name="shopify-checkout-api-token" content="x"><template><div class="cookie-permission-container" data-cookie-permission></div></template></body>',
      PAGE,
      { platform: true },
    );
    expect(shopware5.platform?.selectors).toEqual([
      'meta[name="shopify-digital-wallet"], meta[name="shopify-checkout-api-token"]',
      'body[class*="is--ctl-"]',
      'div.page-wrap--cookie-permission[data-cookie-permission]',
    ]);
  });

  it('class and id selectors ignore case in quirks mode only (no doctype), as in a browser', () => {
    const html = (doctype: string): string => `${doctype}<html><body class="WooCommerce-JS"><script ID="WP-Emoji-Settings"></script></body></html>`;
    expect(snapshotFromHtml(html(''), PAGE, { platform: true }).platform?.selectors).toEqual(['script#wp-emoji-settings', 'body.woocommerce-js, body.woocommerce-no-js']);
    expect(snapshotFromHtml(html('<!DOCTYPE html>'), PAGE, { platform: true }).platform?.selectors).toEqual([]);
    expect(snapshotFromHtml(html('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">'), PAGE, { platform: true }).platform?.selectors).toHaveLength(2);
  });
});

describe('a synthetic Impressum end to end', () => {
  const impressum = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>Impressum – Muster Rösterei GmbH</title>
<style>footer { color: #333; }</style></head>
<body>
<header><nav><a href="/">Start</a> <a href="/shop">Shop</a></nav></header>
<main>
<h1>Impressum</h1>
<h2>Angaben gem&auml;&szlig; &sect; 5 DDG</h2>
<p>Muster R&ouml;sterei GmbH<br>
Bohnenweg 7<br>
54321 Kaffeestadt</p>
<p><strong>Vertreten durch:</strong> Clara Crema</p>
<h2>Kontakt</h2>
<p>Telefon: +49 5432 10987<br>
E-Mail: info [at] muster-roesterei.example</p>
<h2>Registereintrag</h2>
<p>Eintragung im Handelsregister.<br>Registergericht: Amtsgericht Musterburg<br>Registernummer: HRB 98765</p>
<h2>Umsatzsteuer-ID</h2>
<p>Umsatzsteuer-Identifikationsnummer gem&auml;&szlig; &sect; 27 a Umsatzsteuergesetz:<br>DE&nbsp;123456789</p>
<script>var alt = "<p>HRB 11111</p>";</script>
<div hidden>HRB 22222, Amtsgericht Falschstadt</div>
</main>
<footer class="site-footer"><a href="/impressum">Impressum</a> | <a href="/datenschutz">Datenschutz</a></footer>
</body>
</html>`;
  /** What Chromium's innerText gives for this page (written by hand from the innerText rules). */
  const browserText =
    'Start Shop\nImpressum\nAngaben gemäß § 5 DDG\n\nMuster Rösterei GmbH\nBohnenweg 7\n54321 Kaffeestadt\n\nVertreten durch: Clara Crema\n\nKontakt\n\n' +
    'Telefon: +49 5432 10987\nE-Mail: info [at] muster-roesterei.example\n\nRegistereintrag\n\nEintragung im Handelsregister.\nRegistergericht: Amtsgericht Musterburg\nRegisternummer: HRB 98765\n\n' +
    'Umsatzsteuer-ID\n\nUmsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:\nDE\u00a0123456789\n\nImpressum | Datenschutz';

  it('gives the browser text and links, and the field templates find the same fields as on the browser text', () => {
    const snap = snapshotFromHtml(decodeHtml(new TextEncoder().encode(impressum), 'text/html; charset=utf-8'), 'https://www.muster-roesterei.example/impressum');
    expect(snap.title).toBe('Impressum – Muster Rösterei GmbH');
    expect(snap.text).toBe(browserText);
    expect(snap.links.map((l) => [l.href, l.text, l.footer])).toEqual([
      ['https://www.muster-roesterei.example/', 'Start', false],
      ['https://www.muster-roesterei.example/shop', 'Shop', false],
      ['https://www.muster-roesterei.example/impressum', 'Impressum', true],
      ['https://www.muster-roesterei.example/datenschutz', 'Datenschutz', true],
    ]);
    const fields = extractImpressumFields(snap.text, snap.links);
    expect(fields).toEqual(extractImpressumFields(browserText, snap.links));
    expect(fields.address).toMatchObject({ status: 'found', value: { street: 'Bohnenweg 7', postcode: '54321', town: 'Kaffeestadt' } });
    expect(fields.email).toMatchObject({ status: 'found', value: { value: 'info@muster-roesterei.example', form: 'obfuscated' } });
    expect(fields.handelsregister).toMatchObject({ status: 'found', value: { register: 'HRB', number: '98765', court: 'Musterburg' } });
    expect(fields.ustId).toMatchObject({ status: 'found', value: 'DE123456789' });
    for (const field of Object.values(fields)) if (field.status === 'found' && field.source === 'text') expect(snap.text).toContain(field.quote);
  });

  it('reads the same page sent as windows-1252', () => {
    const latin = Uint8Array.from([...impressum.replace('utf-8', 'windows-1252')].map((c) => (c === '–' ? 0x96 : c.charCodeAt(0))));
    const snap = snapshotFromHtml(decodeHtml(latin, 'text/html'), 'https://www.muster-roesterei.example/impressum');
    expect(snap.title).toBe('Impressum – Muster Rösterei GmbH');
    expect(snap.text).toBe(browserText);
  });
});

describe('fixture pages compared with the snapshots Chromium took', () => {
  /**
   * Pages where static HTML cannot give what the browser gives, each with the reason. Everything not
   * listed must match exactly: links (address, text, footer flag), the visible text, title and language,
   * and therefore the Impressum fields found in the text.
   */
  const DIFFERENCES: Record<string, { links?: string; text?: string; fields?: string }> = {
    'impressum/29-email-per-skript': {
      text: 'a script writes the e-mail address into the page',
      fields: 'the e-mail is in the text only after the script ran',
    },
    'legal-links/14-viele-links-davor': {
      text: 'a script builds 1,600 category links',
      links: 'the script-built links push the footer links past the cap in the browser',
    },
    'legal-links/20-grossbuchstaben-verschachtelt': {
      text: 'a style sheet rule (text-transform: uppercase) changes a link text',
      links: 'the same style sheet rule: "DATENSCHUTZ" in the browser, "Datenschutz" in the HTML',
    },
  };

  const FIXTURES = resolve(SCANNER_ROOT, 'fixtures');
  const sets = [
    { pages: 'impressum/pages', snapshots: 'impressum/snapshots', name: 'impressum' },
    { pages: 'legal-links', snapshots: 'legal-links/snapshots', name: 'legal-links' },
  ];
  const cases = sets.flatMap((set) =>
    readdirSync(resolve(FIXTURES, set.pages))
      .filter((file) => file.endsWith('.html'))
      .sort()
      .map((file) => {
        const name = `${set.name}/${file.replace(/\.html$/, '')}`;
        const html = readFileSync(resolve(FIXTURES, set.pages, file), 'utf8');
        const browser = JSON.parse(readFileSync(resolve(FIXTURES, set.snapshots, file.replace(/\.html$/, '.json')), 'utf8')) as {
          url: string;
          title: string;
          lang: string | null;
          text: string;
          links: PageLink[];
        };
        return { name, html, browser };
      }),
  );

  it('covers every fixture page', () => {
    expect(cases.length).toBeGreaterThanOrEqual(59);
    for (const name of Object.keys(DIFFERENCES)) expect(cases.some((c) => c.name === name), name).toBe(true);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (name, { html, browser }) => {
    const snap = snapshotFromHtml(html, browser.url);
    const allowed = DIFFERENCES[name] ?? {};
    expect(snap.url).toBe(browser.url);
    expect(snap.title).toBe(browser.title);
    expect(snap.lang).toBe(browser.lang);
    const same = {
      links: JSON.stringify(snap.links) === JSON.stringify(browser.links),
      text: snap.text === browser.text,
      fields: JSON.stringify(extractImpressumFields(snap.text, snap.links)) === JSON.stringify(extractImpressumFields(browser.text, browser.links)),
    };
    for (const part of ['links', 'text', 'fields'] as const) {
      // A listed difference must still exist, so the list does not keep stale entries.
      if (allowed[part] !== undefined) expect(same[part], `${part} is listed as different: ${allowed[part]}`).toBe(false);
      else if (part === 'links') expect(snap.links).toEqual(browser.links);
      else if (part === 'text') expect(snap.text).toBe(browser.text);
      else expect(extractImpressumFields(snap.text, snap.links)).toEqual(extractImpressumFields(browser.text, browser.links));
    }
  });
});

describe('performance on hostile pages of 2 MB', () => {
  const MB2 = 2 * 1024 * 1024;
  const fill = (unit: string): string => unit.repeat(Math.ceil(MB2 / unit.length)).slice(0, MB2);
  const hostile: [string, string][] = [
    ['unclosed tags, long attributes and stray "<"', fill(`<div><span class="${'x'.repeat(2000)}">< < <<p>text<li>item<td>cell<a href="/x">y<b><i><font>`)],
    ['deep nesting', fill('<div><section><span>')],
    ['many "<" characters', fill('<<<< a<b <')],
    ['an attribute that never ends', `<a href="${'x'.repeat(MB2)}`],
    ['a comment that never ends', `<!--${fill('-x-')}`],
    ['nested links in tables', fill('<a href="/x"><table><tr><td>Text ')],
    ['unclosed links reopened everywhere', `<a href="/x">${fill('<p>eins</p><li>zwei')}`],
    ['references', fill('&amp&#x41;&#99999999;&unknown;&auml&notit; ')],
    ['script with many end-tag look-alikes', `<script>${fill('</scrip </s </>')}`],
    ['long white space in pre and in text', `<pre>${' '.repeat(MB2 / 2)}</pre><p>${'\n '.repeat(MB2 / 4)}x</p>`],
    ['a long table row', `<table><tr>${fill('<td>c')}`],
    ['many attributes in one tag', `<div ${fill('a b c ')}>`],
    ['foreign content', fill('<svg><g><text><math><mi>x')],
    ['many links', fill('<a href="/impressum">Impressum</a> ')],
  ];

  it.each(hostile)('%s', (_name, html) => {
    expect(html.length).toBeGreaterThanOrEqual(MB2 / 2);
    const started = performance.now();
    const snap = snapshotFromHtml(html, PAGE, { platform: true });
    const ms = performance.now() - started;
    expect(snap.text.length).toBeLessThanOrEqual(SNAPSHOT_MAX_TEXT);
    expect(snap.links.length).toBeLessThanOrEqual(SNAPSHOT_MAX_LINKS + SNAPSHOT_MAX_EXTRA_LINKS);
    expect(ms, `${Math.round(ms)} ms`).toBeLessThan(1000);
  });
});
