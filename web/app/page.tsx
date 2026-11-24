import { SiteFooter } from '../components/site-footer';
import { SiteHeader, SiteNav } from '../components/site-header';
import { HomeDrawing } from '../components/home/home-drawing';
import { LayerButtons, LayerProvider } from '../components/home/layers';
import { ScanForm } from '../components/home/scan-form';

const AUTO_GRID_520 = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-12';

export default function HomePage() {
  return (
    <>
      <SiteHeader>
        <SiteNav />
      </SiteHeader>
      <main className="mx-auto box-border flex w-full max-w-page flex-1 flex-col gap-14 px-8 pt-6 pb-18">
        {/* The layer buttons switch the callouts and notes of the drawing in the section above them. */}
        <LayerProvider>
          <section className={`${AUTO_GRID_520} items-center`}>
            <div className="flex flex-col gap-[26px]">
              <h1 className="m-0 font-head text-[length:clamp(52px,6.4vw,104px)] leading-[0.94] font-semibold tracking-[-0.01em]">
                Ihre Website, nachgemessen.
              </h1>
              <p className="m-0 max-w-[30em] text-[20px] leading-[1.55] text-chalk-muted">
                Wir prüfen Startseite und Impressum wie ein echter Besucher und zeigen auf dem Plan, wo etwas nicht stimmt.
                Zu jedem Fund gibt es die passende Anleitung für Ihr System.
              </p>
            </div>
            <HomeDrawing />
          </section>

          <section className={`${AUTO_GRID_520} items-end`}>
            <div className="flex flex-col gap-[18px]">
              <h2 className="m-0 font-head text-[32px] font-semibold">Was wir messen</h2>
              <LayerButtons />
              <p className="m-0 text-[15px] text-chalk-muted">
                Wählen Sie einen Bereich, um ihn auf dem Plan zu sehen. Wir sagen Ihnen auch, wenn ein Gesetz für Sie nicht gilt.
              </p>
            </div>
            <ScanForm />
          </section>
        </LayerProvider>

        <section className="flex flex-col gap-[22px]">
          <h2 className="m-0 font-head text-[32px] font-semibold">Was Ihr Bericht zusätzlich zeigt</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-5">
            <a className="det" href="/bfsg">
              <svg className="ic" width="46" height="34" viewBox="0 0 46 34" aria-hidden="true">
                <path d="M2 2H16V12H2Z" />
                <path d="M30 2H44V12H30Z" />
                <path d="M2 22H16V32H2Z" />
                <path d="M16 7H30M9 12V22" />
              </svg>
              <span className="dett">BFSG-Prüfschema</span>
              <span className="detd">
                Gilt das Barrierefreiheitsstärkungsgesetz für Sie? Drei Fragen, eine klare Antwort.
              </span>
              <span className="detl">Zum Prüfschema</span>
            </a>
            <div className="det">
              <svg className="ic" width="46" height="34" viewBox="0 0 46 34" aria-hidden="true">
                <path d="M2 2H44V32H2Z" />
                <path d="M2 10H44M2 18H44M2 26H44M12 2V32" />
              </svg>
              <span className="dett">Stückliste der fremden Dienste</span>
              <span className="detd">
                Jeder Dienst mit Anbieter und Zeitpunkt. Die Liste übernehmen Sie in Ihre Datenschutzerklärung.
              </span>
            </div>
            <div className="det">
              <svg className="ic" width="46" height="34" viewBox="0 0 46 34" aria-hidden="true">
                <path d="M23 2L43 32H3Z" />
                <path d="M18 24V14h5a3 3 0 0 1 0 6h-5M23 20l4 4" />
              </svg>
              <span className="dett">Revisionen</span>
              <span className="detd">Prüfen Sie nach der Korrektur erneut. Erledigte Funde werden durchgestrichen.</span>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
