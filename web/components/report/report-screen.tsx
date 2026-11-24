import type { Report } from '@website-check/scanner/report';
import { REPORT_TEXTS as T } from '../../lib/report-texts';
import { SiteFooter } from '../site-footer';
import { HeaderAction, SiteHeader, SiteNav } from '../site-header';
import { Measures } from './measures';
import { Priorities } from './priorities';
import { ReportHead } from './report-head';
import s from './report.module.css';
import { Timeline } from './timeline';

// The report (design/reference/bericht.html), upper part (session B3 part 1): the header with the navigation and
// "Neue Prüfung", the head, the Prüfmaße, "Drei Dinge" with the plan and the Zeitschnitt A–A, rendered from a report
// that passed `validateReport`. The Stückliste, the finding details, the help block and the title block follow in B4;
// the last line of every report is here already (product rule 4).
export function ReportScreen({ report, timeZone }: { report: Report; timeZone?: string }) {
  return (
    <>
      <SiteHeader width="report">
        <div className="flex flex-wrap items-center gap-7">
          <SiteNav agencies={false} />
          <HeaderAction href="/">{T.newScan}</HeaderAction>
        </div>
      </SiteHeader>
      <main className="mx-auto box-border w-full max-w-report flex-1 px-8 pt-2 pb-[72px]">
        <article className={s.sheet}>
          <div className="flex flex-col gap-14 p-[clamp(28px,5vw,60px)]">
            <ReportHead report={report} {...(timeZone !== undefined ? { timeZone } : {})} />
            <Measures report={report} />
            <Priorities report={report} />
            <Timeline report={report} />
            <p className={`${s.mut} m-0 text-[14px]`}>{T.disclaimer}</p>
          </div>
        </article>
      </main>
      <SiteFooter width="report" />
    </>
  );
}
