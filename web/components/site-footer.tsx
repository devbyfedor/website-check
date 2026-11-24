import type { SheetWidth } from './site-header';

const MAX_WIDTH: Record<SheetWidth, string> = {
  page: 'max-w-page',
  report: 'max-w-report',
};

// Footer of every page. The three pages it links to are built in stage C.
export function SiteFooter({ width = 'page' }: { width?: SheetWidth }) {
  return (
    <footer className="border-t border-[rgba(242,246,255,0.25)]">
      <div
        className={`mx-auto box-border flex ${MAX_WIDTH[width]} flex-wrap justify-between gap-6 px-8 py-[22px] text-[14px] text-chalk-muted`}
      >
        <span>Website-Check DE</span>
        <div className="flex flex-wrap gap-[22px]">
          <a href="#impressum">Impressum</a>
          <a href="#datenschutz">Datenschutz</a>
          <a href="#barrierefreiheit">Erklärung zur Barrierefreiheit</a>
        </div>
      </div>
    </footer>
  );
}
