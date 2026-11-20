# Website-Check DE: project brief v1

**Status:** approved by the owner on 19 November 2026. Stage A: not started.

**Log**
- 19.11.2026: v1 written. Stages A and B in detail, stages C and D outlined.

Read this file completely before every session, together with `design/README.md`. The session message tells you which session to do. Do that session and only that session.

---

<context>

**People.** Fedor is the owner: product decisions, design approval, logins, pushes and deploys are his. You are the lead developer agent (Claude Code in VS Code on Fedor's Windows laptop). Claude in a chat writes the session messages that Fedor sends you. Your reports are in Russian.

**Product.** A free German-language website checker for German businesses. A visitor enters an address and gets an honest report in about 30 seconds: what on the site can cost money (third-party services before consent, missing mandatory information, the most common accessibility barriers, basic security), and exactly how to fix it for the system the site runs on. Each report ends with "Hilfe bei der Umsetzung anfragen": this is the lead source for Fedor's freelance work. The project is also a portfolio case: full stack, a real browser on the server, accessibility, privacy, security, real users.

**Positioning.** Competitors sell fear of fines. We are honest and clear: technical facts, general risk, exact fixes, and we say openly when a law does not apply to the visitor.

**Machine.** Windows, VS Code, terminal is Windows PowerShell 5.1 (`&&` does not work there, use `;` or separate commands). Project folder `D:\dev\website-check`. Lenovo laptop, 16 GB RAM. If a large download fails, retry it.

**Addresses.** Public GitHub repository `github.com/devbyfedor/website-check` (Fedor creates it and pushes). Site address later: `website-check.devbyfedor-dev.workers.dev`.

**Budget: zero.** Only free tiers. Anything that costs even a few euros a month is out unless Fedor decides otherwise.

**Parallel project.** Fedor also runs the "Trafalgar 1805" project on the same laptop. He coordinates the time. If he tells you that Trafalgar measurements are running, do not start heavy jobs.

</context>

<owner_decisions>

- 23.10.2026: project paused. 19.11.2026: resumed.
- Zero budget, free tiers only (since October 2026).
- 19.11.2026: no separate prototype. Build the real product, starting with the scan core, and measure it on Cloudflare early.
- 19.11.2026: name Website-Check DE. Folder, repository and address: `website-check`.
- 19.11.2026: the repository is public from day one. Results of scans of real third-party websites never go into the repository.
- 19.11.2026: the Impressum of our site will carry Fedor's real name and postal address (stage C).
- 19.11.2026: Fedor answers leads only in writing, by e-mail. The lead form says that the answer comes by e-mail.
- 19.11.2026: Impressum fields are found with templates (regular expressions) first. The Claude API is added later only if the templates miss often on live sites.
- 19.11.2026: design variant "Bauplan" (blueprint) with the improvements is approved. The reference in `design/` is the source of truth.
- Explanations of findings are written in advance and stored in the repository. No AI generates findings or legal explanations at runtime.

</owner_decisions>

<goal>

Version 1: a visitor enters an address, watches the scan screen for about 30 seconds, and gets a report that looks exactly like `design/reference/bericht.html`, filled with real data.

Success criteria for version 1:
- Legal checks (third-party services before consent, mandatory information) produce zero false positives on the 30 test sites. If unsure, the report says "Bitte manuell prüfen", never a violation.
- The six accessibility rules match a reference axe-core run exactly.
- The whole thing runs on Cloudflare free tiers within their limits.
- Our own site passes our own scanner with zero findings and matches the design reference (see `design/README.md`).

</goal>

<scope_v1>

**Pages (designed):** home, scan screen, report, BFSG decision scheme. See `design/README.md`.

**What is checked:** only the homepage and the Impressum page.
1. Third-party services during a visit without any interaction (so without consent): every request is recorded and classified.
2. Mandatory information: links to Impressum and Datenschutzerklärung; in the Impressum: postal address, e-mail, Handelsregister (HRB/HRA) and USt-IdNr where present; for shops, a link to an Erklärung zur Barrierefreiheit.
3. Accessibility, the six most common error types: text contrast, images without alternative text, form fields without labels, empty links, empty buttons, missing page language.
4. Basic security: HTTPS, redirect from http to https, and five headers: Strict-Transport-Security, Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
5. Which system the site runs on: WordPress (with WooCommerce), Shopify, Shopware, Wix, Jimdo, otherwise "unbekannt".

**Not in version 1:** checking the whole site, user accounts, monitoring, payments, the regional study, runtime AI. Revisions and the "Arbeitsauftrag" button are designed but built in stage D.

</scope_v1>

<product_rules>

1. **Before consent, by construction.** The scan never clicks anything. Every third-party request in the capture therefore happened without consent. The time when the consent banner becomes visible is extra information for the "Zeitschnitt A–A" and is best effort: never base a finding on banner timing alone.
2. **Risk classes for third-party services**, kept as data, not code:
   - `precedent`: Google Fonts loaded from Google servers (LG München I, 20.01.2022, 3 O 17493/20).
   - `consent-required`: analytics, tag managers, advertising and social pixels, session recording.
   - `usually-consent`: maps, video embeds, external chat widgets, review widgets.
   - `grey-zone`: public CDNs such as jsDelivr, unpkg, cdnjs. Shown as a hint, never as a violation.
   - `not-flagged`: the site's own servers and the consent tool itself.
   Every class assignment needs a source in `docs/rules-sources.md` (court ruling, guidance of the German data protection authorities, official documentation). No source means `grey-zone`.
3. **Unsure means manual check.** A field that cannot be found (for example an e-mail shown as an image) is "nicht gefunden, bitte manuell prüfen", never "fehlt". Only a missing Impressum link is a finding with a risk.
4. **Wording.** A technical fact plus the general risk. Forbidden in any text: "Sie verstoßen gegen", "illegal", "rechtswidrig", "Abmahngefahr", "abmahnsicher", "rechtssicher", "garantiert", "DSGVO-konform" as a promise. Every report ends with "Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit."
5. **Honesty about the law.** The BFSG does not apply to micro-enterprises that provide services (fewer than 10 employees and annual turnover or balance sheet total of at most 2 million euros). We say so.
6. **Texts.** German texts for findings and fixes live in the repository. The texts in the design reference are final. New texts you write are drafts: mark them as drafts in `docs/content-drafts.md` for review.

</product_rules>

<architecture>

**Platform: everything on Cloudflare free tiers.**
- `web/`: Next.js with static export, TypeScript, Tailwind CSS v4. Served by Workers Static Assets. No server-side rendering on the Worker.
- `worker/`: one Cloudflare Worker for the API, scan orchestration and later the lead form.
- `scanner/`: plain TypeScript, no framework. Shared by the local runner and the Worker.
- Cloudflare Browser Run (formerly Browser Rendering): a real Chromium for the scans.
- Cloudflare D1: database. Cloudflare Turnstile: bot protection (stage C).

**Key rule: capture and analysis are separate.** A capture adapter loads a page and returns a plain data object (requests, main document headers, final URL, page text and links, axe results, timings). Analyzers are pure functions from that object to findings. There are two capture adapters with the same output shape: local Playwright on the laptop (free, no limits, for development and tests) and Cloudflare Browser Run (production). Analyzers are tested without any browser, with synthetic captures and fixtures.

**Free-tier limits, checked on 19.11.2026** (check the Cloudflare docs again if something behaves differently):
- Browser Run: 10 browser minutes per day, reset at 00:00 UTC (01:00 in Berlin in winter); 3 browsers at the same time; at most one new browser every 20 seconds (tabs inside an open browser do not count); a browser closes after 60 seconds idle, but an open browser keeps using the daily minutes, so close it right after the scan; Quick Actions at most one request every 10 seconds per account; after the daily limit, error 429 until the next UTC day.
- Workers: 100,000 requests per day, 10 ms CPU per request (waiting for the network does not count), 128 MB memory, 50 subrequests per request.
- D1: 5 GB, 5 million rows read and 100,000 rows written per day.
- Static assets: free and unlimited.

**Budget rules for browser minutes.** Develop and debug against local Playwright. Use Cloudflare only for measurements and end-to-end checks, at most one full 30-site run per day. Stop a single page after 20 seconds.

**Security of our own service.**
- Every server-side fetch of a user-given address goes through SSRF protection: http and https only; ports 80 and 443 only; reject private, loopback, link-local, CGNAT and other non-public addresses for IPv4 and IPv6, including after resolving the hostname and after every redirect (at most 5); timeout 10 seconds; response body at most 2 MB; no cookies or credentials.
- Report ids are random and unguessable. Reports are not indexed.
- Secrets only in `.dev.vars` locally (never committed) and as Worker secrets set by Fedor.

**Privacy of our own service.** Store the minimum. Never store raw IP addresses: rate limiting uses a hash of the IP with a salt that rotates daily. No analytics with cookies, no third-party requests from our own pages.

</architecture>

<design>

`design/README.md` is part of this brief. Its rules apply to every session of stage B. The files in `design/` are read-only.

If a state is needed that is not designed (an error message, an empty state), build it only from existing components and styles of the reference, and list it in your report for Fedor to review. Never invent new pages or new components.

</design>

<test_sites>

- 30 real German websites in `local/sites.txt`. The folder `local/` is in `.gitignore` and never committed.
- Mix: about 12 online shops (WooCommerce, Shopify, Shopware), about 12 small service businesses (craftsmen, practices, agencies, restaurants), the rest on Wix and Jimdo. Prefer Bavaria. Use public business websites only, no personal blogs.
- Scanning etiquette: only sites from this list; only the homepage and the Impressum; no clicks, no consent buttons, no form submissions, no logins, no probing of paths; at most one full Cloudflare run per day.
- Results stay in `local/`. Committed files contain only aggregated numbers, never site names or per-site findings. In tables use anonymous labels such as "Site 07".

</test_sites>

<stage_a>

Stage A builds the scan core without any user interface. Each session is one or two hours.

### A1: project setup and the first check, locally

1. `git init`. First commit on `main` contains only `design/` and `docs/brief.md`. Then work on branch `a1-setup`.
2. `.gitignore` (at least: `node_modules`, `.next`, `out`, `.wrangler`, `.dev.vars`, `.env*`, `local/`, `test-results`, `playwright-report`). `CLAUDE.md` with the rules of this brief that matter in every session (process, boundaries, report format). `docs/progress.md`, `docs/decisions.md` (copy the owner decisions above with their dates; add your technical decisions with a date and one sentence of reason), `docs/backlog.md`.
3. npm workspaces with `scanner/` and `worker/` (`web/` comes in B1). TypeScript strict, Vitest. Pin the Node version.
4. Rules data for third-party services in `scanner/`: at least 40 hosts common in Germany, each with service name, provider, category and risk class, with sources in `docs/rules-sources.md`.
5. Local capture adapter with Playwright: Chromium, locale `de-DE`, timezone `Europe/Berlin`, viewport 1440 × 900, no interaction, wait for the network to be quiet or at most 15 seconds. Record every request with time relative to the start, the main document headers and the final URL. Detect the consent banner and the time it becomes visible, best effort, with known consent tools (for example Usercentrics, Cookiebot, Borlabs, Complianz, Real Cookie Banner, CCM19, consentmanager, OneTrust and the built-in banners of Shopify, Wix and Jimdo).
6. Analyzer for third-party services: first party by registrable domain (use a public suffix list library), risk class from the rules data, evidence (address and time) for every finding.
7. Unit tests for the rules matching, the domain logic and the findings.
8. Compile the 30 test sites by the rules in `<test_sites>`.
9. Run all 30 locally. Check 5 sites with a Google Fonts finding by hand in the saved capture.

**Merge condition A1**
- `npm test` passes completely;
- at least 27 of 30 sites give a capture, each failure recorded with its reason (timeout, blocked, invalid address);
- 0 false positives in the manual check of 5 sites;
- `git ls-files local` is empty.

### A2: measurement on Cloudflare (the riskiest piece; ends with Fedor's decision)

1. Cloudflare capture adapter in `worker/` with the Browser Run binding, same output shape as the local adapter.
2. Measure two strategies: (a) request events through the browser protocol; (b) collection inside the page with the Resource Timing API, returned in one call, plus the main document headers.
3. Run with `wrangler dev --remote` or remote bindings. No public deploy in A2: if one turns out to be necessary, stop and ask. Fedor runs `npx wrangler login` himself when you ask him to.
4. The lab endpoint is protected with a random token from `.dev.vars`.
5. Budget: the same 12 sites with strategy (a) and with strategy (b), one browser session with tabs, closed at the end. Stop before the daily 10 minutes are used up.
6. Per site and strategy record: Worker CPU time, wall time, browser seconds, requests captured compared with the local capture of the same site (completeness in percent), blocked or not, banner detected and its time.
7. Write the results to `docs/measurements/a2.md` (anonymous labels) and recommend a plan with numbers: A, browser sessions in the Worker within 10 ms CPU; B, Quick Actions; C, move more work into the page. Anything that costs money (for example Workers Paid) is only a note for Fedor.

**Merge condition A2:** tests pass, no secrets in git. The choice of plan is Fedor's: stop after the report.

### A3: accessibility and security checks

1. Inject a pinned version of axe-core and run only these rules: `color-contrast`, `image-alt`, `label`, `link-name`, `button-name`, `html-has-lang`, `html-lang-valid`. Return counts and up to 5 examples per rule (selector, HTML snippet up to 200 characters, contrast values).
2. Security checks from `<scope_v1>`.
3. Synthetic fixture pages in `scanner/fixtures/` for every rule, positive and negative.
4. Local run on the 30 sites. Compare 5 sites with a separate standard axe-core run of the same rules.

**Merge condition A3:** all fixture tests pass; the counts on the 5 comparison sites match exactly; on 5 sites through Cloudflare the plan chosen in A2 still holds (at most 1.5 browser minutes for this check).

### A4: mandatory information and system detection

1. Find the Impressum and Datenschutz links on the homepage (German and English link texts, footer first). Open the Impressum in a second tab of the same browser.
2. Templates for: postal address (street and number, five-digit postcode and town), e-mail (plain, mailto and the usual hidden forms such as "[at]", "(at)", " at ", "[dot]"), Handelsregister (HRA or HRB with number and court), USt-IdNr (DE plus 9 digits).
3. Every field is either found, with the exact quote, or "nicht gefunden, bitte manuell prüfen".
4. Link to an Erklärung zur Barrierefreiheit.
5. System detection with signals documented in `docs/cms-fingerprints.md`.
6. At least 20 synthetic Impressum fixtures in different formats, with invented companies, plus edge cases.

**Merge condition A4:** all fixture tests pass; on 10 of the 30 sites every "found" field is checked by hand: 0 wrong; the detected system is right on 10 hand-checked sites.

### A5: API, storage, cache, limits, quick check, SSRF

1. D1 schema with migrations: `sites`, `scans`, `findings`, `network_requests`, `leads` (table only).
2. API: start a scan (returns the scan id, or the cached one if the same normalized address was scanned in the last 24 hours) and read status and report. The report JSON has a versioned schema in `scanner/`; stage B renders from it.
3. Orchestration within the browser limits from `<architecture>`, with a queue and a position when busy. Choose a free-tier-safe way to run scans of 10 to 30 seconds and justify it in `docs/decisions.md`.
4. When the daily browser limit is reached: a quick check without a browser (HTML source and headers only), and the report is marked as incomplete with "Die vollständige Prüfung ist morgen wieder möglich."
5. Rate limit: 5 scans per hour per visitor, by hashed IP as in `<architecture>`.
6. SSRF protection as in `<architecture>`, with a test suite of at least 15 cases.

**Merge condition A5:** the SSRF suite passes; tests for cache, rate limit and quick check pass; end to end through Cloudflare (`wrangler dev --remote`) 3 real sites give a report JSON that validates against the schema; at most 3 browser minutes used in the session. If A5 does not fit into two hours, split it at a clean commit and report.

</stage_a>

<stage_b>

Stage B builds the user interface exactly as in the design reference. It starts after stage A is merged.

**Visual check, used by every B session:** a Playwright script `npm run visual` takes full-page screenshots of a reference file and of the matching app page at 1440 and 390 px width with `reducedMotion: 'reduce'`, writes diff images to `local/visual/` and prints the share of different pixels per page and width.

### B1: app skeleton and home page
- `web/` with Next.js static export, Tailwind CSS v4 with the values from `design/tokens.css`, Barlow and Barlow Semi Condensed self-hosted with `next/font`, shared header and footer.
- Home page 1:1, including the drawing animation and the layer buttons. The form sends nothing yet.
- The visual check script.

**Merge condition B1:** home differs by at most 1 % at both widths; full axe-core run: 0 violations; the built page makes 0 requests to any other host; every control reachable by keyboard with visible focus.

### B2: scan screen and the connection to the API
- The form starts a scan; the scan screen shows real progress mapped to the steps of the reference, then the "Bericht öffnen" panel.
- States that are not designed (invalid address, site blocked the scan, queue, daily limit and quick check) follow `<design>`.

**Merge condition B2:** the scan screen differs by at most 1 % (final state with fixture data); end to end home → scan → report works for 3 sites in local development; reduced motion shows final states.

### B3: report, part 1
- Head, Prüfmaße, plan with the priorities, Zeitschnitt A–A, rendered from the report JSON.
- An example JSON with exactly the reference data, used for the visual check.

**Merge condition B3:** these sections differ by at most 1 % from the same sections of the reference at both widths.

### B4: report, part 2
- Stückliste with the copy button, the finding detail with system tabs (WAI-ARIA tabs pattern, arrow keys), the help block, the title block.
- Revisions table and "Arbeitsauftrag" button are rendered only for the example JSON (behind a flag that is off in production) so the visual check stays complete.

**Merge condition B4:** the whole report differs by at most 1 % at both widths; full axe-core run: 0 violations; copying works.

### B5: BFSG page and the quality gate
- BFSG page 1:1 with unit tests for all four paths and the reset.
- Quality gate on all pages, on a quiet machine (charger connected, Chrome closed, nobody using the laptop): visual difference at most 1 % at both widths; axe-core 0 violations; Lighthouse desktop Accessibility 100, Best Practices at least 95, Performance at least 95; Lighthouse mobile Performance at least 85; no requests from our pages to any other host.

**No public deploy in stage B.** A business site needs an Impressum first (stage C).

</stage_b>

<later_stages>

Separate briefs follow. For orientation only:
- **C, launch readiness:** lead form (needs a design), Impressum, Datenschutzerklärung and Erklärung zur Barrierefreiheit for our own site, "So prüfen wir" page, Turnstile, lead notifications (Fedor decides: Telegram bot or e-mail), retention period for reports (Fedor decides), quality check of the scanner on the 30 sites against WAVE and Lighthouse, review of the German texts by a native speaker, first public deploy by Fedor.
- **D, second wave:** revisions with crossed-out fixed findings, "Arbeitsauftrag" for developers, the Claude API for Impressum fields if templates miss often, a regional study with aggregated numbers and no company names, monitoring for agencies.

</later_stages>

<process>

- One session per message. Do only the session named in the message.
- Every session works on its own branch from `main`, named after the session (`a2-cloudflare`, …).
- Commit after every step with a clear message.
- Merge into `main` with a real merge, not squash, only when the merge condition holds. If a check fails for real: do not merge and do not fix in circles; commit, describe what failed, and stop.
- At the end of every session update `docs/progress.md`: what was done, the numbers against the merge condition, what comes next. Decisions go to `docs/decisions.md` with date and reason, postponed work to `docs/backlog.md`.
- Background helpers are fine for research (rules sources, CMS signals, test sites), never during measurements.
- Aim for one to two hours. If the session will clearly take longer, stop at a clean commit and say so in the report.
- Never claim that something works without running it. Give numbers.
- If something does not work after several attempts, do not go in circles: commit what you have, describe what blocks you, and stop.

</process>

<boundaries>

- Never push. Never use `--tags`, `--mirror` or `--all`. Fedor pushes `main` himself.
- No deploy unless the session message says so. No public deploy before stage C.
- Zero budget: no paid plans, no trials that need a card, no usage credits; never switch on Workers Paid. If a free limit blocks progress, stop and report.
- Logins (Cloudflare, GitHub) are done by Fedor. Ask him and wait.
- Secrets never go into git, reports or logs.
- Scanning only as described in `<test_sites>`.
- No real company names or per-site results in committed files.
- Do not change anything in `design/`.
- Legal texts you write are drafts; never present them as final.
- No AI-generated findings or explanations at runtime.

</boundaries>

<how_your_turns_end>

Your report is in Russian, in short sentences, without tables. Order:
1. The result in one or two sentences: what was done, merged into `main` or not, the last commit.
2. Numbers against every point of the merge condition.
3. Problems and what you postponed.
4. At most three questions, each with your recommendation in the form "Я за …".
5. What the next session should do.

If the session message does not end with the line "Конец сообщения", the text was cut off: say so in the first line of the report and do nothing else.

</how_your_turns_end>
