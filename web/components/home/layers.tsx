'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import s from './layers.module.css';

// "Was wir messen": four layers of the drawing. A button switches the highlighted callout and the note
// on the drawing; layer 1 is active on load (design/README.md, "Interactive behavior").
export type Layer = 1 | 2 | 3 | 4;

const LAYERS: { n: Layer; title: string; text: string }[] = [
  { n: 1, title: 'Datenschutz', text: 'Welche Dienste Daten senden, bevor jemand zustimmt.' },
  { n: 2, title: 'Pflichtangaben', text: 'Impressum und Datenschutzerklärung, vollständig und erreichbar.' },
  { n: 3, title: 'Barrierefreiheit', text: 'Die sechs häufigsten Fehler, vom Kontrast bis zur Bildbeschreibung.' },
  { n: 4, title: 'Sicherheit', text: 'Verschlüsselung und wichtige Sicherheits-Header.' },
];

const LayerContext = createContext<{ layer: Layer; setLayer: (layer: Layer) => void }>({
  layer: 1,
  setLayer: () => {},
});

// Holds the active layer for the buttons and the drawing, which sit in different sections of the page.
export function LayerProvider({ children }: { children: ReactNode }) {
  const [layer, setLayer] = useState<Layer>(1);
  return <LayerContext value={{ layer, setLayer }}>{children}</LayerContext>;
}

export function useLayer(): Layer {
  return useContext(LayerContext).layer;
}

// The four toggle buttons; the pressed one carries aria-pressed="true", as in the reference.
export function LayerButtons() {
  const { layer, setLayer } = useContext(LayerContext);
  return (
    <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-3 p-0">
      {LAYERS.map(({ n, title, text }) => {
        const on = n === layer;
        return (
          <li key={n}>
            <button type="button" className={on ? `${s.lg} ${s.on}` : s.lg} aria-pressed={on} onClick={() => setLayer(n)}>
              <span className={s.callnum} aria-hidden="true">
                {n}
              </span>
              <span>
                <span className={s.lgt}>{title}</span>
                <span className={s.lgd}>{text}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
