import { SiteFooter } from '../site-footer';
import { HeaderAction, SiteHeader } from '../site-header';
import { Plotter } from './plotter';
import { Protocol } from './protocol';
import { ReportReady } from './report-ready';
import type { ScanScreenData } from './scan-data';

const AUTO_GRID_520 = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-12';

// The scan screen (design/reference/pruefung.html): the header with "Prüfung abbrechen", the address
// being measured, the plotter beside the "Messprotokoll", and "Bericht öffnen" once the report is ready.
// Everything that belongs to one scan comes from `scan`.
export function ScanScreen({ scan }: { scan: ScanScreenData }) {
  return (
    <>
      <SiteHeader>
        <HeaderAction href="/">Prüfung abbrechen</HeaderAction>
      </SiteHeader>
      <main className="mx-auto box-border flex w-full max-w-page flex-1 flex-col gap-10 px-8 pt-4 pb-16">
        <section className="flex flex-col gap-3">
          <h1 className="m-0 font-head text-[length:clamp(40px,4.6vw,68px)] leading-none font-semibold wrap-anywhere">
            {`${scan.domain} wird nachgemessen`}
          </h1>
          <p className="m-0 max-w-[40em] text-[19px] leading-[1.55] text-chalk-muted">
            Wir öffnen Ihre Seite wie ein Besucher aus Deutschland, der noch nichts angeklickt hat. Das dauert etwa 30 Sekunden.
          </p>
        </section>
        <section className={`${AUTO_GRID_520} items-start`}>
          <Plotter label={scan.drawingLabel} marks={scan.marks} />
          <Protocol steps={scan.steps} progress={scan.progress} />
        </section>
        {scan.report ? <ReportReady report={scan.report} /> : null}
      </main>
      <SiteFooter />
    </>
  );
}
