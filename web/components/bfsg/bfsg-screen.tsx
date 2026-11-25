import { BFSG_START, BFSG_TEXTS as T, type BfsgState } from '../../lib/bfsg-view';
import { SiteFooter } from '../site-footer';
import { SiteHeader, SiteNav } from '../site-header';
import { BfsgScheme } from './bfsg-scheme';
import s from './bfsg.module.css';

// The BFSG page (design/reference/bfsg.html): the heading, the decision scheme, "Gut zu wissen" and the way to the check.
// `initial` only for the unit tests.
export function BfsgScreen({ initial = BFSG_START }: { initial?: BfsgState } = {}) {
  return (
    <>
      <SiteHeader>
        <SiteNav current="bfsg" />
      </SiteHeader>
      <main className="mx-auto box-border flex w-full max-w-page flex-1 flex-col gap-12 px-8 pt-6 pb-18">
        <section className="flex max-w-[900px] flex-col gap-5">
          <h1 className="m-0 font-head text-[length:clamp(48px,6vw,96px)] leading-[0.95] font-semibold">{T.heading}</h1>
          <p className="m-0 max-w-[34em] text-[20px] leading-[1.55] text-chalk-muted">{T.lead}</p>
        </section>

        <BfsgScheme initial={initial} />

        <section className="grid max-w-[1120px] grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-6">
          <div className={s.know}>
            <h2 className="m-0 font-head text-[24px] font-semibold">{T.goodToKnow}</h2>
            <ul className="m-0 flex flex-col gap-[10px] pl-5 text-[16px] leading-[1.5] text-chalk-muted">
              {T.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          <div className={s.check}>
            <h2 className="m-0 font-head text-[26px] font-semibold">{T.checkHeading}</h2>
            <p className="m-0 text-[16px] leading-[1.5] text-chalk-muted">{T.checkText}</p>
            <a className={s.btnb} href="/">
              {T.checkLink}
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
