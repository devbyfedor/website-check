import type { ReactNode } from 'react';
import type { Report } from '@website-check/scanner/report';
import { REPORT_TEXTS as T } from '../../lib/report-texts';
import { SiteFooter } from '../site-footer';
import { HeaderAction, SiteHeader, SiteNav } from '../site-header';
import { Measures } from './measures';
import { Notices } from './notices';
import { Priorities } from './priorities';
import { ReportHead } from './report-head';
import s from './report.module.css';
import { Timeline } from './timeline';

/**
 * The page around the sheet of the report (bericht.html): the header with the navigation and "Neue Prüfung", the footer.
 * `status` (the live page only, review of B3 part 2): a status region that is not shown, there from the first paint, so
 * a screen reader hears when the report or a state replaces "Der Bericht wird geladen.".
 */
export function ReportFrame({ children, status }: { children: ReactNode; status?: string }) {
  return (
    <>
      <SiteHeader width="report">
        <div className="flex flex-wrap items-center gap-7">
          <SiteNav agencies={false} />
          <HeaderAction href="/">{T.newScan}</HeaderAction>
        </div>
      </SiteHeader>
      <main className="mx-auto box-border w-full max-w-report flex-1 px-8 pt-2 pb-[72px]">
        {status === undefined ? null : (
          <p role="status" className="sr-only">
            {status}
          </p>
        )}
        <article className={s.sheet}>
          <div className="flex flex-col gap-14 p-[clamp(28px,5vw,60px)]">{children}</div>
        </article>
      </main>
      <SiteFooter width="report" />
    </>
  );
}

// The report (design/reference/bericht.html), upper part (session B3): the head, the notices of a report that is not a
// plain complete check (B3 part 2), the Prüfmaße, "Drei Dinge" with the plan and the Zeitschnitt A–A, rendered from a
// report that passed `validateReport`. The Stückliste, the finding details, the help block and the title block follow
// in B4; the last line of every report is here already (product rule 4).
export function ReportScreen({ report, timeZone, status }: { report: Report; timeZone?: string; status?: string }) {
  return (
    <ReportFrame {...(status !== undefined ? { status } : {})}>
      <ReportHead report={report} {...(timeZone !== undefined ? { timeZone } : {})} />
      <Notices report={report} />
      <Measures report={report} />
      <Priorities report={report} />
      <Timeline report={report} />
      <p className={`${s.mut} m-0 text-[14px]`}>{T.disclaimer}</p>
    </ReportFrame>
  );
}
