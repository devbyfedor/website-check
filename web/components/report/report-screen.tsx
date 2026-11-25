import type { ReactNode } from 'react';
import type { Report } from '@website-check/scanner/report';
import { REPORT_TEXTS as T } from '../../lib/report-texts';
import { SiteFooter } from '../site-footer';
import { HeaderAction, SiteHeader, SiteNav } from '../site-header';
import { FindingCards } from './finding-cards';
import { HelpBlock } from './help-block';
import { Measures } from './measures';
import { Notices } from './notices';
import { Priorities } from './priorities';
import { ReportHead } from './report-head';
import s from './report.module.css';
import { Services } from './services';
import { Timeline } from './timeline';
import { TitleBlock } from './title-block';

/**
 * The page around the sheet of the report (bericht.html): the header with the navigation and "Neue Prüfung", the footer.
 * `status` (the live page only, review of B3 part 2): a status region that is not shown, there from the first paint, so
 * a screen reader hears when the report or a state replaces "Der Bericht wird geladen.". `stamp`: the title block at
 * the foot of the sheet, outside its padded area (session B4).
 */
export function ReportFrame({ children, status, stamp }: { children: ReactNode; status?: string; stamp?: ReactNode }) {
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
          {stamp}
        </article>
      </main>
      <SiteFooter width="report" />
    </>
  );
}

/**
 * The parts of bericht.html that are stage D (brief: "rendered only for the example JSON, behind a flag that is off in
 * production"): only the example page passes them, from components/report/stage-d.tsx.
 */
export interface StageDParts {
  revisions: ReactNode;
  workOrder: { line: ReactNode; link: ReactNode };
}

// The report (design/reference/bericht.html), rendered from a report that passed `validateReport`. The upper part
// (session B3): the head, the notices of a report that is not a plain complete check, the Prüfmaße, "Drei Dinge" with the
// plan and the Zeitschnitt A–A. The lower part (session B4 part 1, `details`): the Stückliste, one finding detail per
// priority, the help block and the title block, with the "Revisionen" and the "Arbeitsauftrag" of stage D where the
// example page passes them. In part 1 only the example page shows the lower part; its data from the API, its states and
// its actions are part 2. The last line of every report is here (product rule 4).
export function ReportScreen({
  report,
  timeZone,
  status,
  details = false,
  stageD,
}: {
  report: Report;
  timeZone?: string;
  status?: string;
  details?: boolean;
  stageD?: StageDParts;
}) {
  const zone = timeZone !== undefined ? { timeZone } : {};
  return (
    <ReportFrame {...(status !== undefined ? { status } : {})} {...(details ? { stamp: <TitleBlock report={report} {...zone} /> } : {})}>
      <ReportHead report={report} {...zone} />
      <Notices report={report} />
      <Measures report={report} />
      <Priorities report={report} />
      <Timeline report={report} />
      {details ? (
        <>
          <Services report={report} />
          <FindingCards report={report} />
          {stageD?.revisions}
          <HelpBlock workOrder={stageD?.workOrder} />
        </>
      ) : null}
      <p className={`${s.mut} m-0 text-[14px]`}>{T.disclaimer}</p>
    </ReportFrame>
  );
}
