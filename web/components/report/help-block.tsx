import type { ReactNode } from 'react';
import type { Report } from '@website-check/scanner/report';
import { DETAIL_TEXTS as T, LEAD_FORM_PATH } from '../../lib/report-detail-texts';
import { helpView } from '../../lib/report-detail-view';
import s from './report.module.css';

// The help block (bericht.html): "Sie möchten das nicht selbst umsetzen?" and the button to the lead form. The button
// leads to the address of the form of stage C and collects nothing (Fedor, B4 part 1). The line about the
// "Arbeitsauftrag" and its button are stage D: only the example page passes them (`workOrder`, components/report/stage-d.tsx).
// Session B4 part 2: the text names what the priorities of the report are about ("Schriften lokal einbinden, die
// Einwilligung richtig einstellen, Barrieren entfernen" for those of the reference); a report without priorities gets
// a heading and a text of its own (drafts). The button stays on every report (brief: each report ends with it).
export function HelpBlock({ report, workOrder }: { report: Report; workOrder?: { line: ReactNode; link: ReactNode } | undefined }) {
  const help = helpView(report);
  return (
    <section className={s.help}>
      <div className="flex max-w-[560px] flex-col gap-2">
        <h2 className={`${s.h2s} text-[28px]!`}>{help.heading}</h2>
        <p className={s.bodys}>{help.text}</p>
        {workOrder?.line}
      </div>
      <div className="flex flex-wrap gap-3">
        <a className={s.btns} href={LEAD_FORM_PATH}>
          {T.helpRequest}
        </a>
        {workOrder?.link}
      </div>
    </section>
  );
}
