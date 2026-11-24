import type { NextConfig } from 'next';

// Static export only (brief, <architecture>): `next build` writes plain files to web/out, which
// Workers Static Assets serves. No server-side rendering on the Worker.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default config;
