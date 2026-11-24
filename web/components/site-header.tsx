import type { ReactNode } from 'react';

export type SheetWidth = 'page' | 'report';

const MAX_WIDTH: Record<SheetWidth, string> = {
  page: 'max-w-page',
  report: 'max-w-report',
};

// The mark of the logo: a sheet with a title block and a tick.
function LogoMark() {
  return (
    <svg className="mk" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path d="M2 2H28V28H2Z" />
      <path d="M2 19H28M15 19V28" />
      <path d="M8 10.5l4 4 9-8" />
    </svg>
  );
}

// Header of every page. `children` is the right side: the navigation, or a single action
// ("Prüfung abbrechen" on the scan screen, navigation plus "Neue Prüfung" on the report).
export function SiteHeader({ width = 'page', children }: { width?: SheetWidth; children?: ReactNode }) {
  return (
    <header
      className={`mx-auto box-border flex w-full ${MAX_WIDTH[width]} flex-wrap items-center justify-between gap-6 px-8 py-6`}
    >
      <a href="/" className="inline-flex items-center gap-3 font-head text-[23px] font-semibold text-chalk no-underline">
        <LogoMark />
        Website-Check
      </a>
      {children}
    </header>
  );
}

// The main navigation of the blueprint pages.
export function SiteNav() {
  return (
    <nav className="nav flex flex-wrap gap-7" aria-label="Hauptnavigation">
      <a href="#methode">So prüfen wir</a>
      <a href="/bfsg">BFSG-Check</a>
      <a href="#agenturen">Für Agenturen</a>
    </nav>
  );
}
