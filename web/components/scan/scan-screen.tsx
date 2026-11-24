import type { MouseEvent } from 'react';
import { SCAN_TEXTS } from '../../lib/scan-texts';
import { SiteFooter } from '../site-footer';
import { HeaderAction, SiteHeader } from '../site-header';
import { Plotter } from './plotter';
import { Protocol } from './protocol';
import { ReportReady } from './report-ready';
import type { ScanScreenData } from './scan-data';

const AUTO_GRID_520 = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-12';

// The heading: "{domain} wird nachgemessen". The example writes it as one string, as the reference does (two text
// nodes are anti-aliased differently); an address from the API is a string of the visitor and stands in <bdi>.
function Heading({ scan }: { scan: ScanScreenData }) {
  const className = 'm-0 font-head text-[length:clamp(40px,4.6vw,68px)] leading-none font-semibold wrap-anywhere';
  const suffix = scan.heading?.suffix ?? SCAN_TEXTS.headingSuffix;
  if (scan.domain === null || suffix === '') return <h1 className={className}>{scan.heading?.withoutHost ?? SCAN_TEXTS.headingWithoutHost}</h1>;
  if (!scan.domainFromApi) return <h1 className={className}>{`${scan.domain}${suffix}`}</h1>;
  return (
    <h1 className={className}>
      <bdi>{scan.domain}</bdi>
      {suffix}
    </h1>
  );
}

// The scan screen (design/reference/pruefung.html): the header with "Prüfung abbrechen", the address
// being measured, the plotter beside the "Messprotokoll", and "Bericht öffnen" once the report is ready.
// Everything that belongs to one scan comes from `scan`; `onCancel` is the real scan's "Prüfung abbrechen"
// (without it the link only leads to the home page, as in the reference).
export function ScanScreen({ scan, onCancel }: { scan: ScanScreenData; onCancel?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <>
      <SiteHeader>
        {scan.action === 'new' ? (
          <HeaderAction href="/">{SCAN_TEXTS.newScan}</HeaderAction>
        ) : (
          <HeaderAction href="/" {...(onCancel !== undefined ? { onClick: onCancel } : {})}>
            Prüfung abbrechen
          </HeaderAction>
        )}
      </SiteHeader>
      <main className="mx-auto box-border flex w-full max-w-page flex-1 flex-col gap-10 px-8 pt-4 pb-16">
        <section className="flex flex-col gap-3">
          <Heading scan={scan} />
          <p className="m-0 max-w-[40em] text-[19px] leading-[1.55] text-chalk-muted">
            Wir öffnen Ihre Seite wie ein Besucher aus Deutschland, der noch nichts angeklickt hat. Das dauert etwa 30 Sekunden.
          </p>
          {/* The real scan only (session B2 part 2): one status region from the start; its text changes only when the
              scan does (in the queue with its place, running, ready, the end of a scan without a report, no connection). */}
          {scan.status !== undefined ? (
            <p role="status" className="m-0 min-h-[1.55em] font-head text-[19px] leading-[1.55] text-cyan">
              {scan.status}
            </p>
          ) : null}
        </section>
        <section className={`${AUTO_GRID_520} items-start`}>
          <Plotter label={scan.drawingLabel} marks={scan.marks} scale={scan.motionScale ?? 1} />
          <Protocol steps={scan.steps} progress={scan.progress} />
        </section>
        {scan.report ? <ReportReady report={scan.report} live={scan.progress.kind === 'live'} /> : null}
      </main>
      <SiteFooter />
    </>
  );
}
