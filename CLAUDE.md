# Website-Check DE: rules for every session

Read `docs/brief.md` completely before every session, together with `design/README.md`. The session message names one session: do that session and only that session. If the session message does not end with the line «Конец сообщения», the text was cut off: say so in the first line of the report and do nothing else.

## People and machine

- Fedor is the owner: product decisions, design approval, logins, pushes and deploys are his.
- Windows laptop, terminal is Windows PowerShell 5.1 (`&&` does not work there, use `;` or separate commands). 16 GB RAM. If a large download fails, retry it.
- If Fedor says that Trafalgar measurements are running, do not start heavy jobs.

## Process

- Every session works on its own branch from `main`, named after the session (`a1-setup`, `a2-cloudflare`, …).
- Commit after every step with a clear message.
- Merge into `main` with a real merge (`git merge --no-ff`), never squash, and only when the merge condition of the session holds. If a check fails for real: do not merge and do not fix in circles; commit, describe what failed, and stop.
- At the end of every session update `docs/progress.md`: what was done, the numbers against the merge condition, what comes next. Decisions go to `docs/decisions.md` with date and a one-sentence reason, postponed work to `docs/backlog.md`.
- Background helpers are fine for research (rules sources, CMS signals, test sites), never during measurements.
- Aim for one to two hours. If the session will clearly take longer, stop at a clean commit and say so in the report.
- Never claim that something works without running it. Give numbers.
- If something does not work after several attempts, do not go in circles: commit what you have, describe what blocks you, and stop.

## Boundaries

- Never push. Never use `--tags`, `--mirror` or `--all`. Fedor pushes `main` himself.
- No deploy unless the session message says so. No public deploy before stage C.
- Zero budget: free tiers only. No paid plans, no trials that need a card, no usage credits, never switch on Workers Paid. If a free limit blocks progress, stop and report.
- Logins (Cloudflare, GitHub) are done by Fedor. Ask him and wait.
- Secrets only in `.dev.vars` locally (never committed) and as Worker secrets set by Fedor. Secrets never go into git, reports or logs.
- Scanning only the sites in `local/sites.txt`, only the homepage and the Impressum. No clicks, no consent buttons, no form submissions, no logins, no probing of paths. At most one full Cloudflare run per day.
- Results of real sites stay in `local/` (git-ignored). Committed files contain only aggregated numbers with anonymous labels such as "Site 07", never site names or per-site findings. `git ls-files local` must stay empty.
- Do not change anything in `design/`.
- Legal texts you write are drafts (mark them in `docs/content-drafts.md`); never present them as final.
- No AI-generated findings or explanations at runtime.

## Product rules the code must follow

- The scan never clicks anything, so every third-party request in a capture happened without consent. The banner time is extra information for the "Zeitschnitt A–A"; never base a finding on banner timing alone.
- Risk classes of third-party services are data (`scanner/data/third-party-services.json`). Every class assignment has a source in `docs/rules-sources.md`. No source means `grey-zone`.
- Unsure means "nicht gefunden, bitte manuell prüfen", never "fehlt" and never a violation.
- Forbidden in any text: "Sie verstoßen gegen", "illegal", "rechtswidrig", "Abmahngefahr", "abmahnsicher", "rechtssicher", "garantiert", "DSGVO-konform" as a promise. Every report ends with "Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit."
- Capture and analysis are separate. A capture adapter returns a plain `Capture` object (`scanner/src/capture/types.ts`); analyzers are pure functions, tested without a browser.
- `scanner/src` outside `scanner/src/local/` must run in a Cloudflare Worker: no Node built-ins there (a unit test checks this).

## Commands (run from the repository root)

- `npm test`: all unit tests (no browser, no network).
- `npm run test:integration`: the Playwright capture adapter against local fixture pages (needs `npx playwright install --no-shell chromium` once).
- `npm run typecheck`: TypeScript strict check of all workspaces.
- `npm run scan:local`: capture and analyze every site in `local/sites.txt`; results go to `local/captures` and `local/results`. `-- --only 3,7` repeats single sites; `-- --reanalyze` recomputes analyses and the summary from the saved captures without visiting any site.
- `npm run explain -- --site 07 --service google-fonts`: shows the requests, frames and initiator chain of one service from a saved capture, for manual checks.
- `npm run visual`: builds `web/` with the example pages (`WC_EXAMPLES=1`) and compares every built page with its reference file at 1440 and 390 px (reduced motion); the scan screen is the example at `/pruefung/beispiel`, the report the example at `/bericht/beispiel` (the whole page; the app's finding details after the first are hidden, because the reference has one card; the reference gets the decided wording of the row "Erklärung zur Barrierefreiheit"; the measure of the report is the comparison with the reference into which the data schema v1 holds is put, the five places listed in `docs/decisions.md` (B4 part 2), and the strict number against the reference with the decided wording only and the number against the unchanged reference are printed next to it). Screenshots and diffs in `local/visual`.
- `npm run motion`: builds `web/` with the example pages and compares the animations of the home page (with the layer switch) of the scan screen and of the report (the marks of the plan; the whole page, against the reference with the data schema v1 holds) with the reference, frame by frame at fixed moments; frames in `local/motion`.
- `npm run a11y`: builds `web/` with the example pages and checks keyboard (the order of the reference, the whole ring in the window after Tab), visible focus (by pixels) and a full axe-core run on the home page, the scan screen and the report (the reference gets the Tab stops of the WAI-ARIA tabs pattern of the system tabs, whose arrow keys are tried in the app); `-- --reference` runs axe on the reference too. Results in `local/a11y`.
- `npm run check:scan`: builds `web/` and checks the real scan screen (`/pruefung?id=…`) with an API answered by the script, queued, running and ready, every state without design (each kind of report, a scan that ended without a report, no connection) and every refused start of the form on the home page, at 1440 and 390 px: axe, contrast by pixels, keyboard and focus, motion within 5 s, reduced motion, the status region and the form's message region, other hosts. Results in `local/scan-check`.
- `npm run check:report`: builds `web/` and checks the real report page (`/bericht?id=…`) with an API answered by the script, every state of `web/components/report/example-report-states.ts` and of the page itself (loading, not ready, ended, not found, our error), at 1440 and 390 px: axe, contrast by pixels, Tab in the order of the reference with the focus ring, 0 animations with reduced motion, motion within 5 s, every value equal to the JSON, no text outside the window at 390 px outside a scroll box, noindex, other hosts; since B4 part 2 the lower part too (the Stückliste, the finding details with the system tabs by keyboard, the help block, the title block), "Als PDF speichern", "Link kopieren" and the copy button of the Stückliste (by the clipboard and the status region), and every state with the print media emulated (no button but the selected tab, no header, navigation or footer, no dark background, axe and the contrast; screenshots `print-*.png`). `node web/scripts/report-check.ts --reports <dir>` checks report files of saved captures instead (values, axe, text at 390 px). Results in `local/report-check`.
- `npm run dev:local`: the production build with both Workers on plain `wrangler dev` (local D1, local Chrome, no Cloudflare account) on http://127.0.0.1:8787/, and three fixture sites to enter in the form (http://localhost:8791/, 8792 slow, 8793 for the queue). A fresh database each start; stop with Ctrl+C.
- `npm run preview`: the production build of `web/` (no example pages; it fails if the example data gets into `web/out`), served on http://127.0.0.1:3000/; it fails if a path of `web/out` contains "beispiel" or a file the example domain or a text of the "Revisionen" and the "Arbeitsauftrag" of stage D. `npm run preview:examples` serves the build with the example pages: the scan screen of the reference at http://127.0.0.1:3000/pruefung/beispiel, the report with the example JSON at `/bericht/beispiel` (`web/components/report/example-report.json`, written by `node web/scripts/make-example-report.ts`; the whole report, and the only page with the "Revisionen" and the "Arbeitsauftrag" of stage D), the states without design at `/pruefung/beispiel/<state>` and `/beispiel/formular/<state>` (lists in `web/components/scan/example-states.ts`) and `/bericht/beispiel/<state>` (list in `web/components/report/example-report-states.ts`).

## Report at the end of a session

In Russian, short sentences, no tables. Order:

1. The result in one or two sentences: what was done, merged into `main` or not, the last commit.
2. Numbers against every point of the merge condition.
3. Problems and what was postponed.
4. At most three questions, each with a recommendation in the form «Я за …».
5. What the next session should do.
