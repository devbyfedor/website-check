import { seconds, type ScanScreenData, type ScanStep } from './scan-data';
import s from './protocol.module.css';

const TICK = 'M4 11.5l4.5 4.5L18 6';
const BANG = 'M11 3.5v10M11 17.5v.6';

function Step({ step }: { step: ScanStep }) {
  const red = step.finding ? ` ${s.red}` : '';
  return (
    <li className={`${s.st}${red}`} style={{ animationDelay: seconds(step.delay) }}>
      <svg viewBox="0 0 22 22" aria-hidden="true">
        <path
          className={`${s.ck}${red}`}
          pathLength={1}
          d={step.finding ? BANG : TICK}
          style={{ animationDelay: seconds(step.delay + 0.05) }}
        />
      </svg>
      <span className={s.stt}>
        {step.title}
        {step.detail ? <small>{step.detail}</small> : null}
      </span>
    </li>
  );
}

// "Messprotokoll" (design/reference/pruefung.html): the time bar from 0 to about 30 seconds and the steps
// of the scan, each lit with its tick when the scan has done it.
export function Protocol({ steps, progress }: Pick<ScanScreenData, 'steps' | 'progress'>) {
  return (
    <div className={s.panel}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 font-head text-[26px] font-semibold">Messprotokoll</h2>
        <span className="font-head text-[15px] text-cyan">Startseite und Impressum</span>
      </div>
      <div aria-hidden="true">
        <div className="relative h-[26px]">
          <div className="absolute top-3 right-0 left-0 h-[1.5px] bg-[rgba(242,246,255,0.35)]" />
          <div
            className={`${s.pbar} absolute top-[11px] left-0 h-1 bg-cyan`}
            style={{ animationDelay: seconds(progress.delay), animationDuration: seconds(progress.duration) }}
          />
          <div className="absolute top-1 left-0 h-[18px] w-[1.5px] bg-chalk" />
          <div className="absolute top-1 right-0 h-[18px] w-[1.5px] bg-chalk" />
        </div>
        <div className="flex justify-between font-head text-[14px] text-cyan">
          <span>0 s</span>
          <span>etwa 30 s</span>
        </div>
      </div>
      <ol className="m-0 list-none border-t border-[rgba(242,246,255,0.18)] p-0">
        {steps.map((step) => (
          <Step key={step.title} step={step} />
        ))}
      </ol>
    </div>
  );
}
