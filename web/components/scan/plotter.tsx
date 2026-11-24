import type { CSSProperties } from 'react';
import line from '../blueprint/drawing.module.css';
import { SketchFrame, type SketchMotion } from '../blueprint/sketch-frame';
import { seconds, type MarkPlace, type PlotMark } from './scan-data';
import s from './plotter.module.css';

const timing = (delay: number, duration?: number): CSSProperties =>
  duration === undefined
    ? { animationDelay: seconds(delay) }
    : { animationDelay: seconds(delay), animationDuration: seconds(duration) };

// When the parts of the example page are drawn on the scan screen (pruefung.html): each line with its
// own duration, the dots with the page's 0.35 s.
const FRAME_MOTION: SketchMotion = {
  draw: s.draw!,
  pop: s.pop!,
  timing: {
    frame: { delay: '.3s', duration: '1.8s' },
    bar: { delay: '2.1s', duration: '.4s' },
    dot1: { delay: '2.15s' },
    dot2: { delay: '2.2s' },
    dot3: { delay: '2.25s' },
    address: { delay: '2.2s', duration: '.5s' },
    lock: { delay: '2.5s', duration: '.4s' },
    hero: { delay: '2.2s', duration: '.8s' },
    cross: { delay: '2.7s', duration: '.5s' },
    heading: { delay: '3.35s', duration: '.45s' },
    text: { delay: '3.7s', duration: '.3s' },
    card1: { delay: '3.9s', duration: '.5s' },
    card2: { delay: '4.15s', duration: '.5s' },
    card3: { delay: '4.4s', duration: '.5s' },
    footer: { delay: '4.7s', duration: '.5s' },
  },
};

// The red outline of each place and where its number stands.
const MARK_SHAPE: Record<MarkPlace, { d: string; x: number; y: number }> = {
  heading: { d: 'M52 246c0-14 70-19 160-18s170 7 168 19-90 17-170 16S52 260 52 246z', x: 396, y: 238 },
  source: { d: 'M38 391c0-10 12-14 21-13s22 3 22 13-12 13-22 12-21-2-21-12z', x: 22, y: 391 },
  subline: { d: 'M64 289c10-5 20 4 30 0s20 4 30 0 20 4 30 0 20 4 30 0 20 4 30 0 20 4 30 0', x: 268, y: 282 },
};

// The plotter of the scan screen (design/reference/pruefung.html): the rail with its carriage, the example
// page (SketchFrame), the code mark and the two footer links, the red marks of the scan with their numbers,
// and the pen. Lines are drawn (`draw`), dots and labels appear (`pop`) with the delays of the reference;
// with reduced motion the final state shows at once.
export function Plotter({ label, marks }: { label: string; marks: PlotMark[] }) {
  return (
    <svg viewBox="0 0 600 450" role="img" aria-label={label} className="block h-auto w-full overflow-visible">
      <path className={line.lt} d="M20 8H580M20 2V14M580 2V14" />
      <g className={s.car}>
        <path className={line.ln} d="M-14 2H14V14H-14Z" />
      </g>
      <SketchFrame motion={FRAME_MOTION} />
      <path className={`${line.lt} ${s.draw}`} pathLength={1} d="M52 386l-6 5 6 5M64 386l6 5-6 5M60 383l-5 16" style={timing(5.05, 0.3)} />
      <text className={`${line.svt} ${s.pop}`} x="84" y="395" style={timing(5.2)}>
        Impressum
      </text>
      <text className={`${line.svt} ${s.pop}`} x="144" y="395" style={timing(5.25)}>
        Datenschutz
      </text>
      {marks.map((m) => {
        const shape = MARK_SHAPE[m.place];
        return [
          <path key={`${m.place}-mark`} className={`${s.rp} ${s.draw}`} pathLength={1} d={shape.d} style={timing(m.draw.delay, m.draw.duration)} />,
          <text key={`${m.place}-number`} className={`${s.rpt} ${s.pop}`} x={shape.x} y={shape.y} style={timing(m.numberDelay)}>
            {m.number}
          </text>,
        ];
      })}
      <g className={s.pen}>
        <circle className={line.ln} cx="0" cy="0" r="7" />
        <path className={line.dim} d="M-13 0H13M0 -13V13" />
      </g>
    </svg>
  );
}
