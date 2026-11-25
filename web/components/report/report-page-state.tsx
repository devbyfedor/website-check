import { PAGE_TEXTS as P, REPORT_TEXTS as T } from '../../lib/report-texts';
import type { ReportPageState } from '../../lib/report-page';
import { ReportFrame } from './report-screen';
import s from './report.module.css';

type Shown = Exclude<ReportPageState, { kind: 'report' }>;

function content(state: Shown, here: string): { title: string; text: string | null; action: { href: string; label: string } | null; host: string | null } {
  switch (state.kind) {
    case 'loading':
      return { title: P.loading, text: null, action: null, host: null };
    case 'not-ready':
      return { ...P.notReady, action: { href: `/pruefung?id=${state.id}`, label: P.notReady.action }, host: state.displayHost };
    case 'ended':
      return { ...P.ended[state.reason], action: { href: '/', label: P.newScan }, host: state.displayHost };
    case 'not-found':
      return { ...P.notFound, action: { href: '/', label: P.newScan }, host: null };
    case 'error':
      return { ...P.error, action: { href: here, label: P.reload }, host: null };
  }
}

// The report page without a report to show (session B3 part 2), built from elements of bericht.html: the head of the
// report ("Prüfbericht für {domain}") when the address is known, the heading of a section, a paragraph and the outlined
// link of the sheet (`.gl`). Not designed: Fedor looks at each state (npm run preview:examples, /bericht/beispiel/<state>).
export function ReportPageStateView({ state, here }: { state: Shown; here: string }) {
  const c = content(state, here);
  const Heading = c.host === null ? 'h1' : 'h2';
  return (
    <ReportFrame>
      {c.host === null ? null : (
        <section className={`${s.sec} ${s.headSec}`}>
          <h1 className="m-0 flex flex-col gap-1.5 font-head font-semibold text-ink">
            <span className="text-[22px] font-medium text-ink-muted">{T.headingFor}</span>
            <bdi className="text-[length:clamp(40px,5vw,64px)] leading-none wrap-anywhere">{c.host}</bdi>
          </h1>
        </section>
      )}
      <section className={s.sec} {...(state.kind === 'loading' ? { role: 'status' } : {})}>
        <Heading className={s.h2s}>{c.title}</Heading>
        {c.text === null ? null : <p className={`${s.bodys} max-w-[46em]`}>{c.text}</p>}
        {c.action === null ? null : (
          <div className="flex flex-wrap gap-3">
            <a className={s.gl} href={c.action.href}>
              {c.action.label}
            </a>
          </div>
        )}
      </section>
    </ReportFrame>
  );
}
