import s from './report-features.module.css';

// "Was Ihr Bericht zusätzlich zeigt": three cards, the first a link to the BFSG scheme (B5).
export function ReportFeatures() {
  return (
    <section className="flex flex-col gap-[22px]">
      <h2 className="m-0 font-head text-[32px] font-semibold">Was Ihr Bericht zusätzlich zeigt</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-5">
        <a className={s.det} href="/bfsg">
          <svg className={s.ic} width="46" height="34" viewBox="0 0 46 34" aria-hidden="true">
            <path d="M2 2H16V12H2Z" />
            <path d="M30 2H44V12H30Z" />
            <path d="M2 22H16V32H2Z" />
            <path d="M16 7H30M9 12V22" />
          </svg>
          <span className={s.dett}>BFSG-Prüfschema</span>
          <span className={s.detd}>
            Gilt das Barrierefreiheitsstärkungsgesetz für Sie? Drei Fragen, eine klare Antwort.
          </span>
          <span className={s.detl}>Zum Prüfschema</span>
        </a>
        <div className={s.det}>
          <svg className={s.ic} width="46" height="34" viewBox="0 0 46 34" aria-hidden="true">
            <path d="M2 2H44V32H2Z" />
            <path d="M2 10H44M2 18H44M2 26H44M12 2V32" />
          </svg>
          <span className={s.dett}>Stückliste der fremden Dienste</span>
          <span className={s.detd}>
            Jeder Dienst mit Anbieter und Zeitpunkt. Die Liste übernehmen Sie in Ihre Datenschutzerklärung.
          </span>
        </div>
        <div className={s.det}>
          <svg className={s.ic} width="46" height="34" viewBox="0 0 46 34" aria-hidden="true">
            <path d="M23 2L43 32H3Z" />
            <path d="M18 24V14h5a3 3 0 0 1 0 6h-5M23 20l4 4" />
          </svg>
          <span className={s.dett}>Revisionen</span>
          <span className={s.detd}>Prüfen Sie nach der Korrektur erneut. Erledigte Funde werden durchgestrichen.</span>
        </div>
      </div>
    </section>
  );
}
