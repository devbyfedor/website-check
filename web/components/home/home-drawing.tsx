'use client';

import type { CSSProperties } from 'react';
import { useLayer, type Layer } from './layers';

// The start of each element's animation, written as in the reference (an inline animation-delay).
const delay = (animationDelay: string): CSSProperties => ({ animationDelay });

// The technical drawing of the home page (design/reference/start.html). Lines are drawn (`draw`),
// labels, callouts and the notes appear (`pop`) in the order and with the delays of the reference;
// with reduced motion the final state shows at once (web/app/globals.css). The active layer
// (layers.tsx) fills its callout and shows its note.
export function HomeDrawing() {
  const layer = useLayer();
  // The callout of the active layer is filled, and only its note is shown.
  const callout = (n: Layer) => (n === layer ? 'cg on' : 'cg');
  const note = (n: Layer) => (n === layer ? 'nt show' : 'nt');
  return (
    <svg
      viewBox="0 0 600 450"
      role="img"
      aria-label="Technische Zeichnung einer Beispiel-Website mit vier markierten Prüfstellen: Schrift, Impressum, Bild und Verschlüsselung."
      className="block h-auto w-full overflow-visible"
    >
      <path className="dim draw" pathLength={1} d="M40 26H560" style={delay('1.9s')} />
      <path className="dim draw" pathLength={1} d="M40 19V33M560 19V33" style={delay('1.9s')} />
      <text className="dimt pop" x="300" y="15" style={delay('2.3s')}>
        1440 px
      </text>
      <path className="ln draw" pathLength={1} d="M40 50H560V400H40Z" style={delay('.2s')} />
      <path className="ln draw" pathLength={1} d="M40 84H560" style={delay('.5s')} />
      <circle className="lt pop" cx="58" cy="67" r="4" style={delay('.7s')} />
      <circle className="lt pop" cx="72" cy="67" r="4" style={delay('.75s')} />
      <circle className="lt pop" cx="86" cy="67" r="4" style={delay('.8s')} />
      <path className="lt draw" pathLength={1} d="M118 59H438V75H118Z" style={delay('.6s')} />
      <path className="ln draw" pathLength={1} d="M418 67v-2.5a3.5 3.5 0 0 1 7 0V67M416 67H427V73H416Z" style={delay('.9s')} />
      <path className="ln draw" pathLength={1} d="M64 104H536V214H64Z" style={delay('.8s')} />
      <path className="lt draw" pathLength={1} d="M64 104L536 214M536 104L64 214" style={delay('1s')} />
      <path className="hd draw" pathLength={1} d="M64 246H368" style={delay('1.1s')} />
      <path className="lt draw" pathLength={1} d="M64 280H246" style={delay('1.2s')} />
      <path className="ln draw" pathLength={1} d="M64 302H212V370H64Z" style={delay('1.3s')} />
      <path className="ln draw" pathLength={1} d="M226 302H374V370H226Z" style={delay('1.4s')} />
      <path className="ln draw" pathLength={1} d="M388 302H536V370H388Z" style={delay('1.5s')} />
      <path className="lt draw" pathLength={1} d="M40 382H560" style={delay('1.6s')} />
      <text className="svt pop" x="64" y="395" style={delay('1.8s')}>
        Impressum
      </text>
      <text className="svt pop" x="124" y="395" style={delay('1.85s')}>
        Datenschutz
      </text>
      <g className="pop" style={delay('2.4s')}>
        <g className={callout(1)}>
          <path className="lead" d="M372 246H450" />
          <circle className="callc" cx="466" cy="246" r="15" />
          <text className="callt" x="466" y="246">
            1
          </text>
        </g>
      </g>
      <g className="pop" style={delay('2.6s')}>
        <g className={callout(2)}>
          <path className="lead" d="M92 401L124 424" />
          <circle className="callc" cx="136" cy="432" r="15" />
          <text className="callt" x="136" y="432">
            2
          </text>
        </g>
      </g>
      <g className="pop" style={delay('2.8s')}>
        <g className={callout(3)}>
          <circle className="callc" cx="300" cy="159" r="15" />
          <text className="callt" x="300" y="159">
            3
          </text>
        </g>
      </g>
      <g className="pop" style={delay('3s')}>
        <g className={callout(4)}>
          <path className="lead" d="M441 67H480" />
          <circle className="callc" cx="496" cy="67" r="15" />
          <text className="callt" x="496" y="67">
            4
          </text>
        </g>
      </g>
      <g className="pop" style={delay('3.3s')}>
        <g className={note(1)}>
          <rect className="ntb" x="372" y="264" width="214" height="38" rx="3" />
          <text className="ntt" x="384" y="280">
            Google Fonts
          </text>
          <text className="ntd" x="384" y="295">
            lädt vor der Einwilligung
          </text>
        </g>
        <g className={note(2)}>
          <rect className="ntb" x="160" y="412" width="214" height="37" rx="3" />
          <text className="ntt" x="172" y="428">
            Impressum gefunden
          </text>
          <text className="ntd" x="172" y="442">
            Anschrift, E-Mail, Register
          </text>
        </g>
        <g className={note(3)}>
          <rect className="ntb" x="322" y="141" width="200" height="37" rx="3" />
          <text className="ntt" x="334" y="157">
            Bild ohne Beschreibung
          </text>
          <text className="ntd" x="334" y="171">
            Alternativtext fehlt
          </text>
        </g>
        <g className={note(4)}>
          <rect className="ntb" x="330" y="90" width="214" height="37" rx="3" />
          <text className="ntt" x="342" y="106">
            Verschlüsselung aktiv
          </text>
          <text className="ntd" x="342" y="120">
            3 von 5 Sicherheits-Headern fehlen
          </text>
        </g>
      </g>
    </svg>
  );
}
