import type { ReactNode } from 'react';
import type { Report } from '@website-check/scanner/report';
import { REPORT_TEXTS as T } from '../../lib/report-texts';
import { headFacts } from '../../lib/report-view';
import { HeadActions } from './copy-actions';
import s from './report.module.css';

// The head of the report (bericht.html): "Prüfbericht für {domain}", the actions of the page and the four facts. The
// domain comes from the report (`site.displayHost`), a string of the visitor: a text node in <bdi>.
// Session B4 part 1: the country of the visit carries a short note in a second <dd> (the small grey line of Soll and Ist).
// Session B4 part 2: "Als PDF speichern" prints, "Link kopieren" copies the address; "An Entwickler weitergeben" is
// stage D, passed by the example page only (`developer`).
export function ReportHead({ report, timeZone, developer }: { report: Report; timeZone?: string; developer?: ReactNode }) {
  return (
    <section className={`${s.sec} ${s.headSec}`}>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <h1 className="m-0 flex flex-col gap-1.5 font-head font-semibold text-ink">
          <span className="text-[22px] font-medium text-ink-muted">{T.headingFor}</span>
          <bdi className="text-[length:clamp(40px,5vw,64px)] leading-none wrap-anywhere">{report.site.displayHost}</bdi>
        </h1>
        <HeadActions developer={developer} />
      </div>
      <dl className="m-0 flex flex-wrap gap-x-11 gap-y-2.5 text-[15.5px]">
        {headFacts(report, timeZone).map((f) => (
          <div key={f.label}>
            <dt className={s.mut}>{f.label}</dt>
            <dd className="mx-0 mt-0.5 mb-0 font-semibold">{f.value}</dd>
            {f.note === undefined ? null : <dd className={`${s.mut} m-0 mt-0.5 max-w-[300px] text-[13px]`}>{f.note}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
