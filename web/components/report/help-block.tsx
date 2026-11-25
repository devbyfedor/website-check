import type { ReactNode } from 'react';
import { DETAIL_TEXTS as T, LEAD_FORM_PATH } from '../../lib/report-detail-texts';
import s from './report.module.css';

// The help block (bericht.html): "Sie möchten das nicht selbst umsetzen?" and the button to the lead form. The button
// leads to the address of the form of stage C and collects nothing (Fedor, B4 part 1). The line about the
// "Arbeitsauftrag" and its button are stage D: only the example page passes them (`workOrder`, components/report/stage-d.tsx).
export function HelpBlock({ workOrder }: { workOrder?: { line: ReactNode; link: ReactNode } | undefined }) {
  return (
    <section className={s.help}>
      <div className="flex max-w-[560px] flex-col gap-2">
        <h2 className={`${s.h2s} text-[28px]!`}>{T.helpHeading}</h2>
        <p className={s.bodys}>{T.helpText}</p>
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
