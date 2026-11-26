/**
 * Synthetic pages of 2 MiB for the memory of the quick check's HTML reader (session C2, Fedor's answer 2 after C1):
 * the six heaviest pages of the reader in fix-a4 (one of them reset the queue object on Cloudflare in C1), the hostile
 * pages of the CPU tests of fix-a4 and fix-a6 (`html-snapshot-edge.test.ts`), and more pages of many small elements,
 * attributes, text pieces and links. Invented markup only, no address of anyone.
 */

export const MB2 = 2 * 1024 * 1024;

const fill = (unit: string, n = MB2): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const exactly = (head: string, unit: string): string => head + fill(unit, MB2 - head.length);
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

export const HEAVY_HTML: Record<string, () => string> = {
  // An ordinary page of 2 MiB: paragraphs with a link.
  ordinary: () => fill('<p>Willkommen bei der Beispiel GmbH. <a href="/impressum">Impressum</a></p>'),
  // The six heaviest of fix-a4, as served by the lab pages Worker of C1 (`worker/src/lab/pages.ts`).
  'td-in-one-row': () => exactly('<table><tr>', '<td>c'),
  hr: () => fill('<hr>'),
  'empty-p': () => fill('<p>'),
  'dd-dt': () => exactly('<dl>', '<dd><span><dt><span>'),
  'table-foster-text': () => exactly('<table>', 'x<b>y'),
  'nested-tables': () => fill('<table><tr><td><table>'),
  // The hostile pages of the CPU tests (fix-a4, fix-a6).
  'body-again': () => upTo('<body>', (i) => `<body a${i}>`),
  'html-again': () => upTo('<p>x', (i) => `<html a${i}>`),
  'two-bodies-90000-attributes': () => `<body ${attributes(90000)}><body ${attributes(90000)}>`,
  'link-60000-attributes-reopened': () => upTo(`<p><a href="/x" ${attributes(60000)}>t</p>`, () => '<p>t</p>'),
  'link-1mb-style-reopened': () => upTo(`<p><a href="/x" style="${'a:b;'.repeat(250000)}">t</p>`, () => '<p>t</p>'),
  'nested-hidden-links-br': () => upTo(`<body>${'<a href="/x"><object>'.repeat(256)}`, () => '<br>'),
  'nested-hidden-links-text': () => chains('<a href="/x"><object>', '</object></a>', 250, 'Wort '.repeat(14000)),
  'nested-links-cells-text': () => chains('<a href="/x"><table><tr><td>', '</td></tr></table></a>', 125, 'W'.repeat(8300)),
  'script-escapes': () => `<script><!--<script>${fill('</scrip <!-- --x -> <script </script- <')}`,
  'many-scripts': () => fill('<script><!--<script></script>--></script>'),
  'details-links': () => `<details><summary>s</summary>${fill('<a href="/x">t</a>')}`,
  'css-table-rows': () => `<div style="display:table">${fill('<div style="display:table-row"><div style="display:table-cell">c</div></div>')}`,
  'tbody-per-row': () => `<table>${fill('<tbody><tr><td>x')}`,
  // More for the memory: the shortest elements, attributes, text pieces, links, foreign content.
  br: () => fill('<br>'),
  'unknown-element': () => fill('<x>'),
  'open-b': () => fill('<b>'),
  'eight-attributes': () => fill('<i a b c d e f g h>'),
  'text-between-comments': () => fill('a<!---->'),
  entities: () => `<p>${fill('&amp;')}`,
  links: () => fill('<a href=/x>t</a>'),
  'links-long-text': () => fill(`<a href=/x>${'W'.repeat(200)}</a>`),
  'svg-g': () => `<svg>${fill('<g>')}`,
  'text-and-b': () => fill('x<b>'),
  li: () => `<ul>${fill('<li>')}`,
  option: () => `<select>${fill('<option>')}`,
  'img-alt': () => fill('<img alt=x src=/a>'),
  'div-style': () => fill('<div style="color:red">'),
  meta: () => `<head>${fill('<meta name=generator content=x>')}`,
  'two-byte-text': () => `<p>${fill('ä€')}`,
};
