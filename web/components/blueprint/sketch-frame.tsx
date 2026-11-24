import type { CSSProperties } from 'react';
import line from './drawing.module.css';

// The parts of the example web page that the blueprint drawings draw, in the order of the reference:
// the window, the browser bar with three dots, the address bar and the lock, the hero image with its
// cross, the heading, a line of text, three cards and the footer line.
export type SketchPart =
  | 'frame'
  | 'bar'
  | 'dot1'
  | 'dot2'
  | 'dot3'
  | 'address'
  | 'lock'
  | 'hero'
  | 'cross'
  | 'heading'
  | 'text'
  | 'card1'
  | 'card2'
  | 'card3'
  | 'footer';

// How a page animates the frame: its classes for a drawn line and for a part that appears, and the
// start (and, where the page sets one, the duration) of every part, written as in the reference.
export interface SketchMotion {
  draw: string;
  pop: string;
  timing: Record<SketchPart, { delay: string; duration?: string }>;
}

// "Rahmen der Zeichnung": the example page in the 600 × 450 drawing, the same on the home page
// (start.html) and on the scan screen (pruefung.html, B2); only the timing differs. It renders SVG
// elements for a parent <svg viewBox="0 0 600 450">, between the page's own elements.
export function SketchFrame({ motion }: { motion: SketchMotion }) {
  const { draw, pop, timing } = motion;
  const at = (part: SketchPart): CSSProperties => {
    const { delay, duration } = timing[part];
    return duration ? { animationDelay: delay, animationDuration: duration } : { animationDelay: delay };
  };
  return (
    <>
      <path className={`${line.ln} ${draw}`} pathLength={1} d="M40 50H560V400H40Z" style={at('frame')} />
      <path className={`${line.ln} ${draw}`} pathLength={1} d="M40 84H560" style={at('bar')} />
      <circle className={`${line.lt} ${pop}`} cx="58" cy="67" r="4" style={at('dot1')} />
      <circle className={`${line.lt} ${pop}`} cx="72" cy="67" r="4" style={at('dot2')} />
      <circle className={`${line.lt} ${pop}`} cx="86" cy="67" r="4" style={at('dot3')} />
      <path className={`${line.lt} ${draw}`} pathLength={1} d="M118 59H438V75H118Z" style={at('address')} />
      <path
        className={`${line.ln} ${draw}`}
        pathLength={1}
        d="M418 67v-2.5a3.5 3.5 0 0 1 7 0V67M416 67H427V73H416Z"
        style={at('lock')}
      />
      <path className={`${line.ln} ${draw}`} pathLength={1} d="M64 104H536V214H64Z" style={at('hero')} />
      <path className={`${line.lt} ${draw}`} pathLength={1} d="M64 104L536 214M536 104L64 214" style={at('cross')} />
      <path className={`${line.hd} ${draw}`} pathLength={1} d="M64 246H368" style={at('heading')} />
      <path className={`${line.lt} ${draw}`} pathLength={1} d="M64 280H246" style={at('text')} />
      <path className={`${line.ln} ${draw}`} pathLength={1} d="M64 302H212V370H64Z" style={at('card1')} />
      <path className={`${line.ln} ${draw}`} pathLength={1} d="M226 302H374V370H226Z" style={at('card2')} />
      <path className={`${line.ln} ${draw}`} pathLength={1} d="M388 302H536V370H388Z" style={at('card3')} />
      <path className={`${line.lt} ${draw}`} pathLength={1} d="M40 382H560" style={at('footer')} />
    </>
  );
}
