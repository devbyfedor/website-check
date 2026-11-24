import type { ScanScreenData } from './scan-data';

// The example scan of design/reference/pruefung.html, the only place of its data: the fictional shop,
// its steps, its three red marks, its summary, and the times at which the reference shows each of them
// (the whole run compressed to about 8 seconds). It feeds the example page that only the checks build
// (app/pruefung/beispiel/page.example.tsx, WC_EXAMPLES=1); a production build that contains it fails
// (web/scripts/next.ts). A visitor never sees it: in B2 part 2 the API gives the real scan.
export const EXAMPLE_SCAN: ScanScreenData = {
  domain: 'roesterei-muster.de',
  drawingLabel: 'Der Plotter zeichnet die geprüfte Startseite und markiert drei Funde rot: Überschrift, Quelltext am Seitenende und Unterzeile.',
  marks: [
    { place: 'heading', numbers: [1], draw: { delay: 5.3, duration: 0.6 }, numberDelay: 5.9 },
    { place: 'source', numbers: [2], draw: { delay: 5.85, duration: 0.5 }, numberDelay: 6.35 },
    { place: 'subline', numbers: [3], draw: { delay: 6.4, duration: 0.5 }, numberDelay: 6.95 },
  ],
  steps: [
    { title: 'Seite aufgerufen', detail: 'wie von einem Besucher aus Deutschland', delay: 0.4 },
    { title: '17 Anfragen aufgezeichnet', detail: 'davon 9 an fremde Server', delay: 1.4 },
    { title: 'Einwilligungsbanner erkannt', detail: 'sichtbar nach 1,4 Sekunden', delay: 2.3 },
    {
      title: '3 fremde Dienste vor der Einwilligung',
      detail: 'Google Fonts, Google Tag Manager, Google Analytics',
      finding: true,
      delay: 3.2,
    },
    { title: 'Impressum gefunden', detail: 'unter /impressum', delay: 4.1 },
    { title: 'Pflichtangaben gelesen', detail: 'Anschrift, E-Mail, Handelsregister', delay: 4.9 },
    { title: 'Barrierefreiheit geprüft', detail: 'die 6 häufigsten Fehlertypen', delay: 5.7 },
    { title: 'Verschlüsselung und Sicherheits-Header gelesen', delay: 6.5 },
  ],
  progress: { kind: 'timed', delay: 0.2, duration: 7.2 },
  report: {
    summary: '7 Funde, davon 3 vorrangig. Zu jedem gibt es eine Anleitung für WordPress.',
    href: '/bericht',
    delay: 7.4,
  },
};
