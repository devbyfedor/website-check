/**
 * Session fix-a4: heavy pages for the integration tests of both capture adapters, built from the review's
 * reproductions of findings 4, 10 and 13. Served only by the fixture servers on 127.0.0.1.
 *
 * - `/heavy/flood`: 5,000 requests, started and aborted at once;
 * - `/heavy/flood-net`: requests that are answered, in bursts, for 13 seconds;
 * - `/heavy/long-addresses`: 200 requests with an address of 1 MB each;
 * - `/heavy/long-links`: a document address of 20,000 characters, 1,600 links to anchors of the page and
 *   an Impressum link to a page of the same kind;
 * - `/heavy/big-fields`: title, language, the state of the banner probe and a consent signal of 5 MB each;
 * - `/heavy/fake-axe`: a `window.axe` of the page's own that returns megabyte strings;
 * - `/heavy/big-ids`: twelve images without a description whose id is 1 MB long;
 * - `/heavy/slice`: as `big-fields`, on a page that replaces the methods the snapshot uses for cutting;
 * - `/heavy/long-header`: a Permissions-Policy header with a run of 64,000 spaces;
 * - `/heavy/plain`: an ordinary page, for a scan that runs beside a heavy one.
 */

export interface HeavyAnswer {
  status: number;
  type: string;
  body: string;
  headers?: Record<string, string>;
}

const AXE_RULES = ['color-contrast', 'image-alt', 'label', 'link-name', 'button-name', 'html-has-lang', 'html-lang-valid'];
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const html = (title: string, body: string, lang = ' lang="de"'): HeavyAnswer => ({
  status: 200,
  type: 'text/html; charset=utf-8',
  body: `<!doctype html><html${lang}><head><meta charset="utf-8"><title>${title}</title></head><body><h1>Hallo</h1><p>Eine gewöhnliche Seite mit etwas Text.</p>${body}</body></html>`,
});

const longLinks = (path: string, title: string): HeavyAnswer =>
  html(
    title,
    `<script>history.replaceState(null, '', '${path}?' + 'q'.repeat(20000));</script>${Array.from({ length: 1600 }, (_, i) => `<a href="#a${i}">x</a>`).join('')}<footer><a href="/heavy/long-links-impressum">Impressum</a></footer>`,
  );

const BIG_FIELDS = `
const big = 5000000;
document.title = 'T'.repeat(big);
document.documentElement.setAttribute('lang', 'l'.repeat(big));
const p = window.__wcBannerProbe;
if (p) { p.found = { toolId: 'x'.repeat(big), selector: 's'.repeat(big), method: 'selector', at: 1 }; p.present['p'.repeat(big)] = 1; }
window.Cookiebot = { consented: false, declined: false, consent: { method: 'm'.repeat(big) } };`;

export function heavyPage(path: string): HeavyAnswer | null {
  switch (path) {
    case '/heavy/n':
      return { status: 204, type: 'text/plain', body: '' };
    case '/heavy/plain':
      return html('Fixture Shop', '<a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a><script>var n = 0; var t = setInterval(function () { fetch("/heavy/n?" + (n++)).catch(function () {}); if (n > 5) clearInterval(t); }, 400);</script>');
    case '/heavy/flood':
      return html(
        'Fixture Shop',
        `<a href="/impressum">Impressum</a><script>
let k = 0;
function burst() {
  for (let i = 0; i < 500 && k < 5000; i += 1) { const c = new AbortController(); fetch('/heavy/n?' + (k++), { signal: c.signal }).catch(() => {}); c.abort(); }
  if (k < 5000) setTimeout(burst, 0);
}
burst();
</script>`,
      );
    case '/heavy/flood-net':
      return html(
        'Fixture Shop',
        `<a href="/impressum">Impressum</a><script>
let k = 0;
function burst() {
  for (let i = 0; i < 200; i += 1) fetch('/heavy/n?' + (k++)).catch(() => {});
  if (performance.now() < 13000) setTimeout(burst, 0);
}
burst();
</script>`,
      );
    case '/heavy/ws-flood':
      // Session fix-a5 (backlog of fix-a4): WebSockets in bursts of 300 for 13 s; the server refuses the upgrade, Chromium
      // refuses most sockets before it creates them, and each refusal is still a message of the browser.
      return html(
        'Fixture Shop',
        `<a href="/impressum">Impressum</a><script>
let k = 0;
function burst() {
  for (let i = 0; i < 300; i += 1) { try { const s = new WebSocket('ws://' + location.host + '/heavy/s' + (k++)); s.onerror = function () {}; s.onclose = function () {}; } catch (e) {} }
  if (performance.now() < 13000) setTimeout(burst, 0);
}
burst();
</script>`,
      );
    case '/heavy/long-addresses':
      return html(
        'Fixture Shop',
        `<a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a><p>${'Kaffee aus Musterhausen, frisch geröstet. '.repeat(60)}</p><script>
const pad = 'p'.repeat(1000000);
for (let i = 0; i < 200; i += 1) { const c = new AbortController(); fetch('/heavy/n?' + i + pad, { signal: c.signal }).catch(() => {}); c.abort(); }
</script>`,
      );
    case '/heavy/long-links':
      return longLinks('/heavy/long-links', 'Fixture Shop');
    case '/heavy/long-links-impressum':
      return longLinks('/heavy/long-links-impressum', 'Impressum');
    case '/heavy/big-fields':
      return html('t', `<script>${BIG_FIELDS}</script>`, '');
    case '/heavy/slice':
      return html(
        't',
        `<script>
const huge = 'z'.repeat(3000000);
String.prototype.slice = function () { return huge; };
String.prototype.substring = function () { return huge; };
String.prototype.trim = function () { return huge; };
Array.prototype.slice = function () { return [huge, huge, huge]; };
${BIG_FIELDS}
</script><a href="/impressum">Impressum</a>`,
        '',
      );
    case '/heavy/fake-axe':
      return html(
        't',
        `<script>
const big = 'x'.repeat(1000000);
const contrast = { ratio: 1, expected: big, fgColor: big, bgColor: big, fontSize: big, fontWeight: big, messageKey: big };
const example = () => ({ target: [big, big], html: big, contrast });
const rules = {};
for (const id of ${JSON.stringify(AXE_RULES)}) rules[id] = { violations: 5, incomplete: 0, passes: 0, impact: big, examples: [example(), example(), example(), example(), example()], incompleteExamples: [] };
const fake = { version: big, utils: { aggregateResult: (r) => r }, addReporter: () => {}, run: async () => ({ rules, ruleErrors: [big, big, big], lowestContrast: { violation: contrast, pass: contrast }, junk: [big, big, big, big, big] }) };
Object.defineProperty(window, 'axe', { get: () => fake, set: () => {}, configurable: false });
</script>`,
      );
    case '/heavy/big-ids':
      return html('t', `${Array.from({ length: 12 }, () => `<img src="${GIF}" width="20" height="20">`).join('')}<script>let k = 0; for (const img of document.images) img.id = 'i' + (k++) + 'x'.repeat(1000000);</script>`);
    case '/heavy/long-header':
      return { ...html('Fixture Shop', '<a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a>'), headers: { 'permissions-policy': `geolocation=()${' '.repeat(64000)},camera=()` } };
    default:
      return null;
  }
}

/** The bounds of session fix-a4 for a heavy page: the capture as JSON, and the CPU time of building its report. */
export const HEAVY_BOUNDS = { captureChars: 2_000_000, analysisCpuMs: 1_000 } as const;

export function cpuMsOf<T>(work: () => T): { value: T; ms: number } {
  const before = process.cpuUsage();
  const value = work();
  const used = process.cpuUsage(before);
  return { value, ms: (used.user + used.system) / 1000 };
}
