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
- `npm run visual`: builds `web/` with the example pages (`WC_EXAMPLES=1`) and compares every built page with its reference file at 1440 and 390 px (reduced motion); the scan screen is the example at `/pruefung/beispiel`. Screenshots and diffs in `local/visual`.
- `npm run motion`: builds `web/` with the example pages and compares the animations of the home page (with the layer switch) and of the scan screen with the reference, frame by frame at fixed moments; frames in `local/motion`.
- `npm run a11y`: builds `web/` with the example pages and checks keyboard (the order of the reference, the whole ring in the window after Tab), visible focus (by pixels) and a full axe-core run on the home page and the scan screen; `-- --reference` runs axe on the reference too. Results in `local/a11y`.
- `npm run preview`: the production build of `web/` (no example pages; it fails if the example data gets into `web/out`), served on http://127.0.0.1:3000/. `npm run preview:examples` serves the build with the example pages (the scan screen at http://127.0.0.1:3000/pruefung/beispiel).

## Report at the end of a session

In Russian, short sentences, no tables. Order:

1. The result in one or two sentences: what was done, merged into `main` or not, the last commit.
2. Numbers against every point of the merge condition.
3. Problems and what was postponed.
4. At most three questions, each with a recommendation in the form «Я за …».
5. What the next session should do.
