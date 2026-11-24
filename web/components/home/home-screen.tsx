import { SiteFooter } from '../site-footer';
import { SiteHeader, SiteNav } from '../site-header';
import { HomeDrawing } from './home-drawing';
import { LayerButtons, LayerProvider } from './layers';
import { ReportFeatures } from './report-features';
import { ScanForm, type ScanFormProps } from './scan-form';

const AUTO_GRID_520 = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-12';

// The home page (design/reference/start.html). `form` only for the example pages of the refused starts (session B2 part 3).
export function HomeScreen({ form }: { form?: ScanFormProps } = {}) {
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
            <ScanForm {...form} />
          </section>
        </LayerProvider>

        <ReportFeatures />
      </main>
      <SiteFooter />
    </>
  );
}
