'use client';

import type { CSSProperties } from 'react';
import line from '../blueprint/drawing.module.css';
import { SketchFrame, type SketchMotion } from '../blueprint/sketch-frame';
import { useLayer, type Layer } from './layers';
import s from './home-drawing.module.css';

// The start of each element's animation, written as in the reference (an inline animation-delay).
const delay = (animationDelay: string): CSSProperties => ({ animationDelay });

// When the parts of the example page are drawn on the home page (start.html); the durations are the
// page's own (1.2 s for a line, 0.45 s for a dot).
const FRAME_MOTION: SketchMotion = {
  draw: s.draw!,
  pop: s.pop!,
  timing: {
    frame: { delay: '.2s' },
    bar: { delay: '.5s' },
    dot1: { delay: '.7s' },
    dot2: { delay: '.75s' },
    dot3: { delay: '.8s' },
    address: { delay: '.6s' },
    lock: { delay: '.9s' },
    hero: { delay: '.8s' },
    cross: { delay: '1s' },
    heading: { delay: '1.1s' },
    text: { delay: '1.2s' },
    card1: { delay: '1.3s' },
    card2: { delay: '1.4s' },
    card3: { delay: '1.5s' },
    footer: { delay: '1.6s' },
  },
};

// The technical drawing of the home page (design/reference/start.html): the dimension line, the
// example page (SketchFrame), the footer links, then the four callouts and their notes. Lines are drawn
// (`draw`), labels, callouts and the notes appear (`pop`) in the order and with the delays of the
// reference; with reduced motion the final state shows at once. The active layer (layers.tsx) fills
// its callout and shows its note.
export function HomeDrawing() {
  const layer = useLayer();
  const callout = (n: Layer) => (n === layer ? s.on : undefined);
  const note = (n: Layer) => (n === layer ? `${s.nt} ${s.show}` : s.nt);
  return (
    <svg
      viewBox="0 0 600 450"
      role="img"
      aria-label="Technische Zeichnung einer Beispiel-Website mit vier markierten Prüfstellen: Schrift, Impressum, Bild und Verschlüsselung."
      className="block h-auto w-full overflow-visible"
    >
      <path className={`${line.dim} ${s.draw}`} pathLength={1} d="M40 26H560" style={delay('1.9s')} />
      <path className={`${line.dim} ${s.draw}`} pathLength={1} d="M40 19V33M560 19V33" style={delay('1.9s')} />
      <text className={`${s.dimt} ${s.pop}`} x="300" y="15" style={delay('2.3s')}>
        1440 px
      </text>
      <SketchFrame motion={FRAME_MOTION} />
      <text className={`${line.svt} ${s.pop}`} x="64" y="395" style={delay('1.8s')}>
        Impressum
      </text>
      <text className={`${line.svt} ${s.pop}`} x="124" y="395" style={delay('1.85s')}>
        Datenschutz
      </text>
      <g className={s.pop} style={delay('2.4s')}>
        <g className={callout(1)}>
          <path className={s.lead} d="M372 246H450" />
          <circle className={s.callc} cx="466" cy="246" r="15" />
          <text className={s.callt} x="466" y="246">
            1
          </text>
        </g>
      </g>
      <g className={s.pop} style={delay('2.6s')}>
        <g className={callout(2)}>
          <path className={s.lead} d="M92 401L124 424" />
          <circle className={s.callc} cx="136" cy="432" r="15" />
          <text className={s.callt} x="136" y="432">
            2
          </text>
        </g>
      </g>
      <g className={s.pop} style={delay('2.8s')}>
        <g className={callout(3)}>
          <circle className={s.callc} cx="300" cy="159" r="15" />
          <text className={s.callt} x="300" y="159">
            3
          </text>
        </g>
      </g>
      <g className={s.pop} style={delay('3s')}>
        <g className={callout(4)}>
          <path className={s.lead} d="M441 67H480" />
          <circle className={s.callc} cx="496" cy="67" r="15" />
          <text className={s.callt} x="496" y="67">
            4
          </text>
        </g>
      </g>
      <g className={s.pop} style={delay('3.3s')}>
        <g className={note(1)}>
          <rect className={s.ntb} x="372" y="264" width="214" height="38" rx="3" />
          <text className={s.ntt} x="384" y="280">
            Google Fonts
          </text>
          <text className={s.ntd} x="384" y="295">
            lädt vor der Einwilligung
          </text>
        </g>
        <g className={note(2)}>
          <rect className={s.ntb} x="160" y="412" width="214" height="37" rx="3" />
          <text className={s.ntt} x="172" y="428">
            Impressum gefunden
          </text>
          <text className={s.ntd} x="172" y="442">
            Anschrift, E-Mail, Register
          </text>
        </g>
        <g className={note(3)}>
          <rect className={s.ntb} x="322" y="141" width="200" height="37" rx="3" />
          <text className={s.ntt} x="334" y="157">
            Bild ohne Beschreibung
          </text>
          <text className={s.ntd} x="334" y="171">
            Alternativtext fehlt
          </text>
        </g>
        <g className={note(4)}>
          <rect className={s.ntb} x="330" y="90" width="214" height="37" rx="3" />
          <text className={s.ntt} x="342" y="106">
            Verschlüsselung aktiv
          </text>
          <text className={s.ntd} x="342" y="120">
            3 von 5 Sicherheits-Headern fehlen
          </text>
        </g>
      </g>
    </svg>
  );
}
