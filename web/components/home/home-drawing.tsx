// The technical drawing of the home page (design/reference/start.html), in its final state:
// every line drawn, layer 1 highlighted. The class `draw` gives the drawn lines their final dash state;
// the drawing animation and the switching of the layers follow in the second part of B1.
export function HomeDrawing() {
  return (
    <svg
      viewBox="0 0 600 450"
      role="img"
      aria-label="Technische Zeichnung einer Beispiel-Website mit vier markierten Prüfstellen: Schrift, Impressum, Bild und Verschlüsselung."
      className="block h-auto w-full overflow-visible"
    >
      <path className="dim draw" pathLength={1} d="M40 26H560" />
      <path className="dim draw" pathLength={1} d="M40 19V33M560 19V33" />
      <text className="dimt" x="300" y="15">
        1440 px
      </text>
      <path className="ln draw" pathLength={1} d="M40 50H560V400H40Z" />
      <path className="ln draw" pathLength={1} d="M40 84H560" />
      <circle className="lt" cx="58" cy="67" r="4" />
      <circle className="lt" cx="72" cy="67" r="4" />
      <circle className="lt" cx="86" cy="67" r="4" />
      <path className="lt draw" pathLength={1} d="M118 59H438V75H118Z" />
      <path className="ln draw" pathLength={1} d="M418 67v-2.5a3.5 3.5 0 0 1 7 0V67M416 67H427V73H416Z" />
      <path className="ln draw" pathLength={1} d="M64 104H536V214H64Z" />
      <path className="lt draw" pathLength={1} d="M64 104L536 214M536 104L64 214" />
      <path className="hd draw" pathLength={1} d="M64 246H368" />
      <path className="lt draw" pathLength={1} d="M64 280H246" />
      <path className="ln draw" pathLength={1} d="M64 302H212V370H64Z" />
      <path className="ln draw" pathLength={1} d="M226 302H374V370H226Z" />
      <path className="ln draw" pathLength={1} d="M388 302H536V370H388Z" />
      <path className="lt draw" pathLength={1} d="M40 382H560" />
      <text className="svt" x="64" y="395">
        Impressum
      </text>
      <text className="svt" x="124" y="395">
        Datenschutz
      </text>
      <g>
        <g className="cg on">
          <path className="lead" d="M372 246H450" />
          <circle className="callc" cx="466" cy="246" r="15" />
          <text className="callt" x="466" y="246">
            1
          </text>
        </g>
      </g>
      <g>
        <g className="cg">
          <path className="lead" d="M92 401L124 424" />
          <circle className="callc" cx="136" cy="432" r="15" />
          <text className="callt" x="136" y="432">
            2
          </text>
        </g>
      </g>
      <g>
        <g className="cg">
          <circle className="callc" cx="300" cy="159" r="15" />
          <text className="callt" x="300" y="159">
            3
          </text>
        </g>
      </g>
      <g>
        <g className="cg">
          <path className="lead" d="M441 67H480" />
          <circle className="callc" cx="496" cy="67" r="15" />
          <text className="callt" x="496" y="67">
            4
          </text>
        </g>
      </g>
      <g>
        <g className="nt show">
          <rect className="ntb" x="372" y="264" width="214" height="38" rx="3" />
          <text className="ntt" x="384" y="280">
            Google Fonts
          </text>
          <text className="ntd" x="384" y="295">
            lädt vor der Einwilligung
          </text>
        </g>
        <g className="nt">
          <rect className="ntb" x="160" y="412" width="214" height="37" rx="3" />
          <text className="ntt" x="172" y="428">
            Impressum gefunden
          </text>
          <text className="ntd" x="172" y="442">
            Anschrift, E-Mail, Register
          </text>
        </g>
        <g className="nt">
          <rect className="ntb" x="322" y="141" width="200" height="37" rx="3" />
          <text className="ntt" x="334" y="157">
            Bild ohne Beschreibung
          </text>
          <text className="ntd" x="334" y="171">
            Alternativtext fehlt
          </text>
        </g>
        <g className="nt">
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
