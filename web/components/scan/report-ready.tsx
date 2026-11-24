import { PhraseText } from './phrase';
import { seconds, type ScanScreenData } from './scan-data';
import s from './report-ready.module.css';

// The panel at the end of the scan screen (design/reference/pruefung.html): the report is ready, a line
// about its findings, and the link to it. It exists only once the report is there, so "Bericht öffnen" is never
// in the Tab order before (Fedor, B2 part 2).
export function ReportReady({ report, live = false }: { report: NonNullable<ScanScreenData['report']>; live?: boolean }) {
  return (
    <section
      className={`${s.done}${live ? ` ${s.live}` : ''} flex flex-wrap items-center justify-between gap-x-7 gap-y-4 border-[1.5px] border-solid border-chalk bg-blueprint-deep px-6 py-5`}
      style={{ animationDelay: seconds(report.delay) }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-head text-[26px] font-semibold">Fertig. Ihr Bericht ist gezeichnet.</h2>
        <p className="m-0 text-[16px] text-chalk-muted">
          <PhraseText phrase={report.summary} />
        </p>
      </div>
      <a className={s.btnb} href={report.href}>
        Bericht öffnen
      </a>
    </section>
  );
}
