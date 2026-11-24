import type { NextConfig } from 'next';

// Pages for the checks only: a file named page.example.tsx (the scan screen with the example of the
// reference) is a page when WC_EXAMPLES=1 (`npm run build:examples`, which npm run visual, motion, a11y
// and preview:examples use). The production build (`npm run build`) leaves them out, and
// web/scripts/next.ts fails it if the example data shows up in web/out.
const EXAMPLES = process.env.WC_EXAMPLES === '1';

// Static export only (brief, <architecture>): `next build` writes plain files to web/out, which
// Workers Static Assets serves. No server-side rendering on the Worker.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  pageExtensions: EXAMPLES ? ['example.tsx', 'tsx', 'ts', 'jsx', 'js'] : ['tsx', 'ts', 'jsx', 'js'],
};

export default config;
