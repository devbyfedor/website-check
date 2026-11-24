import type { CSSProperties } from 'react';
import { PhraseText } from './phrase';
import { seconds, type ScanProgress, type ScanScreenData, type ScanStep } from './scan-data';
import s from './protocol.module.css';

const TICK = 'M4 11.5l4.5 4.5L18 6';
const BANG = 'M11 3.5v10M11 17.5v.6';

// One row. The example lights each row at its time of the reference; the real scan (`live`) shows a row that waits
// for the report dimmed at a contrast of at least 4.5:1 without a tick (Fedor, B2 part 2), and lights every row of
// the report at once; a part the scan did not check is lit without a tick (B2 part 3).
function Step({ step, live }: { step: ScanStep; live: boolean }) {
  const red = step.finding ? ` ${s.red}` : '';
  if (step.delay === null) {
    return (
      <li className={`${s.st} ${s.wait}`}>
        <svg viewBox="0 0 22 22" aria-hidden="true" />
        <span className={s.stt}>
          <PhraseText phrase={step.title} />
        </span>
      </li>
    );
  }
  return (
    <li className={`${s.st}${live ? ` ${s.now}` : ''}${red}`} style={{ animationDelay: seconds(step.delay) }}>
      <svg viewBox="0 0 22 22" aria-hidden="true">
        {step.unchecked ? null : (
          <path
            className={`${s.ck}${red}`}
            pathLength={1}
            d={step.finding ? BANG : TICK}
            style={{ animationDelay: seconds(step.delay + 0.05) }}
          />
        )}
      </svg>
      <span className={s.stt}>
        <PhraseText phrase={step.title} />
        {step.detail ? (
          <small>
            <PhraseText phrase={step.detail} />
          </small>
        ) : null}
      </span>
    </li>
  );
}

// The time bar: in the example it grows over the compressed run of the reference; for the real scan it grows in
// real time from the start of the scan and stops short of the end until the report is there.
function bar(progress: ScanProgress): { className: string; style: CSSProperties } {
  if (progress.kind === 'timed') return { className: s.pbar!, style: { animationDelay: seconds(progress.delay), animationDuration: seconds(progress.duration) } };
  if (progress.phase === 'done') return { className: s.pfull!, style: {} };
  if (progress.phase === 'waiting') return { className: s.pwait!, style: {} };
  return { className: s.prun!, style: { animationDelay: seconds(-progress.since) } };
}

// "Messprotokoll" (design/reference/pruefung.html): the time bar from 0 to about 30 seconds and the steps
// of the scan, each lit with its tick when the scan has done it.
export function Protocol({ steps, progress }: Pick<ScanScreenData, 'steps' | 'progress'>) {
  const live = progress.kind === 'live';
  const pbar = bar(progress);
  return (
    <div className={s.panel}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 font-head text-[26px] font-semibold">Messprotokoll</h2>
        <span className="font-head text-[15px] text-cyan">Startseite und Impressum</span>
      </div>
      <div aria-hidden="true">
        <div className="relative h-[26px]">
          <div className="absolute top-3 right-0 left-0 h-[1.5px] bg-[rgba(242,246,255,0.35)]" />
          <div className={`${pbar.className} absolute top-[11px] left-0 h-1 bg-cyan`} style={pbar.style} />
          <div className="absolute top-1 left-0 h-[18px] w-[1.5px] bg-chalk" />
          <div className="absolute top-1 right-0 h-[18px] w-[1.5px] bg-chalk" />
        </div>
        <div className="flex justify-between font-head text-[14px] text-cyan">
          <span>0 s</span>
          <span>etwa 30 s</span>
        </div>
      </div>
      <ol className="m-0 list-none border-t border-[rgba(242,246,255,0.18)] p-0">
        {steps.map((step, i) => (
          <Step key={i} step={step} live={live} />
        ))}
      </ol>
    </div>
  );
}
