import type { CSSProperties } from 'react';
import line from '../blueprint/drawing.module.css';
import { SketchFrame, type SketchMotion } from '../blueprint/sketch-frame';
import { seconds, type MarkPlace, type PlotMark } from './scan-data';
import s from './plotter.module.css';

const timing = (delay: number, duration?: number): CSSProperties =>
  duration === undefined
    ? { animationDelay: seconds(delay) }
    : { animationDelay: seconds(delay), animationDuration: seconds(duration) };

// When the parts of the example page are drawn on the scan screen (pruefung.html), in seconds: each line with its
// own duration, the dots with the page's 0.35 s.
const FRAME_TIMES: Record<keyof SketchMotion['timing'], { delay: number; duration?: number }> = {
  frame: { delay: 0.3, duration: 1.8 },
  bar: { delay: 2.1, duration: 0.4 },
  dot1: { delay: 2.15 },
  dot2: { delay: 2.2 },
  dot3: { delay: 2.25 },
  address: { delay: 2.2, duration: 0.5 },
  lock: { delay: 2.5, duration: 0.4 },
  hero: { delay: 2.2, duration: 0.8 },
  cross: { delay: 2.7, duration: 0.5 },
  heading: { delay: 3.35, duration: 0.45 },
  text: { delay: 3.7, duration: 0.3 },
  card1: { delay: 3.9, duration: 0.5 },
  card2: { delay: 4.15, duration: 0.5 },
  card3: { delay: 4.4, duration: 0.5 },
  footer: { delay: 4.7, duration: 0.5 },
};

/** The pen and the carriage: 7 s from 0.3 s in the reference (`plotter.module.css`). */
const PEN = { delay: 0.3, duration: 7 };

// The times of the drawing, scaled: 1 for the example of the reference; the real scan uses a smaller scale so that
// the drawing, the pen and the carriage end within 5 s (Fedor, B2 part 2: the pen goes its route faster and stops).
function frameMotion(scale: number): SketchMotion {
  const timingOf = (t: { delay: number; duration?: number }) => ({
    delay: seconds(t.delay * scale),
    ...(t.duration !== undefined ? { duration: seconds(t.duration * scale) } : {}),
  });
  return {
    draw: s.draw!,
    pop: s.pop!,
    timing: Object.fromEntries(Object.entries(FRAME_TIMES).map(([part, t]) => [part, timingOf(t)])) as SketchMotion['timing'],
  };
}

/** When the last motion of the drawing ends at a scale (the pen; the texts end earlier), in seconds. */
export const drawingEnd = (scale: number): number => (PEN.delay + PEN.duration) * scale;

// The red outline of each place and where its number stands.
const MARK_SHAPE: Record<MarkPlace, { d: string; x: number; y: number }> = {
  heading: { d: 'M52 246c0-14 70-19 160-18s170 7 168 19-90 17-170 16S52 260 52 246z', x: 396, y: 238 },
  source: { d: 'M38 391c0-10 12-14 21-13s22 3 22 13-12 13-22 12-21-2-21-12z', x: 22, y: 391 },
  subline: { d: 'M64 289c10-5 20 4 30 0s20 4 30 0 20 4 30 0 20 4 30 0 20 4 30 0 20 4 30 0', x: 268, y: 282 },
};

// The plotter of the scan screen (design/reference/pruefung.html): the rail with its carriage, the example
// page (SketchFrame), the code mark and the two footer links, the red marks of the scan with their numbers,
// and the pen. Lines are drawn (`draw`), dots and labels appear (`pop`) with the delays of the reference
// (times `scale`); with reduced motion the final state shows at once.
export function Plotter({ label, marks, scale = 1 }: { label: string; marks: PlotMark[]; scale?: number }) {
  // The example keeps the pen's times in its class, as the reference does; another scale sets them inline.
  const pen = scale === 1 ? undefined : timing(PEN.delay * scale, PEN.duration * scale);
  return (
    <svg viewBox="0 0 600 450" role="img" aria-label={label} className="block h-auto w-full overflow-visible">
      <path className={line.lt} d="M20 8H580M20 2V14M580 2V14" />
      <g className={s.car} style={pen}>
        <path className={line.ln} d="M-14 2H14V14H-14Z" />
      </g>
      <SketchFrame motion={frameMotion(scale)} />
      <path className={`${line.lt} ${s.draw}`} pathLength={1} d="M52 386l-6 5 6 5M64 386l6 5-6 5M60 383l-5 16" style={timing(5.05 * scale, 0.3 * scale)} />
      <text className={`${line.svt} ${s.pop}`} x="84" y="395" style={timing(5.2 * scale)}>
        Impressum
      </text>
      <text className={`${line.svt} ${s.pop}`} x="144" y="395" style={timing(5.25 * scale)}>
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
      <g className={s.pen} style={pen}>
        <circle className={line.ln} cx="0" cy="0" r="7" />
        <path className={line.dim} d="M-13 0H13M0 -13V13" />
      </g>
    </svg>
  );
}
