import localFont from 'next/font/local';

// Barlow (400, 500, 600) and Barlow Semi Condensed (500, 600), self-hosted (design/README.md, rule 3).
// The files and their source: web/fonts/README.md. The site never requests fonts from Google.
export const barlow = localFont({
  src: [
    { path: '../fonts/barlow-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/barlow-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/barlow-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-barlow',
  display: 'swap',
});

export const barlowSemiCondensed = localFont({
  src: [
    { path: '../fonts/barlow-semi-condensed-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/barlow-semi-condensed-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-barlow-semi-condensed',
  display: 'swap',
});

/**
 * Session B3 part 2 (Fedor): the latin-ext subset (Polish, Czech, Turkish and other letters of Latin Extended), so such
 * names of a scanned site are shown in the same font. Its range (written out in both calls: next/font takes only literals) is that of Google Fonts and Fontsource for latin-ext;
 * the browser loads a file only when the page has a letter in it. The faces stand first in the font lists of
 * globals.css: a letter outside the range goes on to the latin subset, and no file is preloaded. They have no fallback
 * face of their own, so a letter outside both subsets (Cyrillic, Greek, …) goes on to the fallback of the latin subset.
 */
export const barlowExt = localFont({
  src: [
    { path: '../fonts/barlow-latin-ext-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/barlow-latin-ext-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/barlow-latin-ext-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-barlow-ext',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF' }],
});

export const barlowSemiCondensedExt = localFont({
  src: [
    { path: '../fonts/barlow-semi-condensed-latin-ext-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/barlow-semi-condensed-latin-ext-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-barlow-semi-condensed-ext',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF' }],
});
