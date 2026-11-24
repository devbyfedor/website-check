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
