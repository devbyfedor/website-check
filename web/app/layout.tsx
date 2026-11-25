import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { barlow, barlowExt, barlowSemiCondensed, barlowSemiCondensedExt } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Website-Check DE',
};

// The blueprint sheet that every page lies on. Header and footer differ between the pages
// (navigation, "Neue Prüfung", the narrower report), so each page renders them itself.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={`${barlow.variable} ${barlowSemiCondensed.variable} ${barlowExt.variable} ${barlowSemiCondensedExt.variable}`}>
      <body>
        <div className="paper flex min-h-full flex-col">{children}</div>
      </body>
    </html>
  );
}
