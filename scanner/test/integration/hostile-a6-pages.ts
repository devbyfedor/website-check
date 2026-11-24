/**
 * Session fix-a6: pages of the review's reproductions, served by the fixture servers of both adapters' integration
 * tests (only on 127.0.0.1).
 *
 * Finding 26: a page with one real barrier of each of the six error types that tries to give the scanner a false axe
 * result: a fake `window.axe` that cannot be overwritten, an accessor that ignores the write, a trap that replaces
 * `run` on the real axe object, and a page that repairs its own DOM the moment axe-core installs itself. In the
 * isolated world axe runs in, none of them reaches axe, so every variant gives the six barriers.
 *
 * Finding 77: a CSP meta element in <body> (browsers ignore it) and one in <head>.
 */

const BODY = `<h1>Hallo</h1>
<p style="color:#bbbbbb;background:#ffffff">Grauer Text auf weissem Grund, zu wenig Kontrast.</p>
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="40" height="40">
<a href="/x"></a>
<button></button>
<input type="text">
<footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></footer>`;

const FAKE = `
const R = (passes) => ({ violations: 0, incomplete: 0, passes, impact: null, examples: [], incompleteExamples: [] });
const fake = { version: '4.14.1', utils: { aggregateResult() { return {}; } }, addReporter() {},
  run: async () => ({ rules: { 'color-contrast': R(12), 'image-alt': R(3), label: R(1), 'link-name': R(4), 'button-name': R(1), 'html-has-lang': R(1), 'html-lang-valid': R(1) },
    ruleErrors: [], lowestContrast: { violation: null, pass: { ratio: 21, expected: '4.5:1', fgColor: '#000000', bgColor: '#ffffff', fontSize: '12.0pt (16px)', fontWeight: 'normal', messageKey: null } } }) };
`;

const page = (script: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>Test</title>${script === '' ? '' : `<script>${script}</script>`}</head><body>${BODY}</body></html>`;

export const HOSTILE_AXE_PAGES: Record<string, string> = {
  honest: page(''),
  frozen: page(`${FAKE} Object.defineProperty(window, 'axe', { value: fake, writable: false, configurable: false });`),
  setter: page(`${FAKE} Object.defineProperty(window, 'axe', { get() { return fake; }, set(v) {}, configurable: false });`),
  trap: page(`${FAKE} let real; Object.defineProperty(window, 'axe', { configurable: true, get() { return real; }, set(v) { real = v;
    Object.defineProperty(v, 'run', { get() { return fake.run; }, set() {}, configurable: false });
    Object.defineProperty(v, 'addReporter', { get() { return () => {}; }, set() {}, configurable: false }); } });`),
  domfix: page(`let real; Object.defineProperty(window, 'axe', { configurable: true, get() { return real; }, set(v) { real = v;
    document.documentElement.lang = 'de';
    document.querySelectorAll('img').forEach((e) => { e.alt = 'x'; });
    document.querySelectorAll('a,button,input').forEach((e) => { e.setAttribute('aria-label', 'x'); });
    document.querySelectorAll('p').forEach((e) => { e.style.color = '#000000'; }); } });`),
};

/** The violations of the six barriers by axe rule (the page has no lang attribute). */
export const HOSTILE_AXE_VIOLATIONS = { 'color-contrast': 1, 'image-alt': 1, label: 1, 'link-name': 1, 'button-name': 1, 'html-has-lang': 1 } as const;

const TEXT = '<p>Willkommen bei der Erfundenen Beispiel GmbH in Musterstadt.</p>'.repeat(30);
export const CSP_META_PAGES: Record<string, string> = {
  'csp-meta-body': `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Test</title></head><body>${TEXT}<meta http-equiv="Content-Security-Policy" content="img-src 'none'"><footer><a href="/impressum">Impressum</a></footer></body></html>`,
  'csp-meta-head': `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="img-src 'self'"><title>Test</title></head><body>${TEXT}<footer><a href="/impressum">Impressum</a></footer></body></html>`,
};
