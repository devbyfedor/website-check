import type { MouseEvent, ReactNode } from 'react';
import s from './site-header.module.css';

export type SheetWidth = 'page' | 'report';

const MAX_WIDTH: Record<SheetWidth, string> = {
  page: 'max-w-page',
  report: 'max-w-report',
};

// The mark of the logo: a sheet with a title block and a tick.
function LogoMark() {
  return (
    <svg className={s.mark} width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
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

// The outlined link on the right of the header: "Prüfung abbrechen" on the scan screen, "Neue Prüfung"
// on the report (`.newb` in pruefung.html and bericht.html).
export function HeaderAction({ href, children, onClick }: { href: string; children: ReactNode; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <a className={s.newb} href={href} {...(onClick !== undefined ? { onClick } : {})}>
      {children}
    </a>
  );
}

// The main navigation of the blueprint pages. The report has it without "Für Agenturen" (bericht.html).
export function SiteNav({ agencies = true }: { agencies?: boolean }) {
  return (
    <nav className={`${s.nav} flex flex-wrap gap-7`} aria-label="Hauptnavigation">
      <a href="#methode">So prüfen wir</a>
      <a href="/bfsg">BFSG-Check</a>
      {agencies ? <a href="#agenturen">Für Agenturen</a> : null}
    </nav>
  );
}
