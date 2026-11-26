# Website-Check DE: brief for stage C (launch readiness)

**Status:** v1 of the stage C brief, written on 26 November 2026 from Fedor's answers in the chat. Points marked "(proposed)" were suggested by Claude in the chat and stand unless Fedor changes them. Stage C: in progress (C1 and C2 done on 26.11.2026).

**Log**
- 26.11.2026: written. Sessions C1 (measurements on Cloudflare) and C2 (fixes from the measurements) ran before this brief existed; they are listed below.
- 26.11.2026: C1 and C2 done (both merged into `main`). Stage C continues with C3.

Read this file completely before every stage C session, together with `docs/brief.md` (brief v1) and `design/README.md`. Brief v1 still applies in full: context, owner decisions, product rules, architecture, test sites, process, boundaries and the report format. This file adds the decisions, sessions and merge conditions of stage C. Where the two differ, this file wins for stage C. The session message tells you which session to do. Do that session and only that session.

---

<goal>

The first public launch: a real visitor on the public address can run a check, read the report, contact Fedor through the lead form, and read the Impressum, the Datenschutzerklärung and the Erklärung zur Barrierefreiheit of our own site.

The launch is ready when:
- every item of "Before the launch (stage C)" in `docs/backlog.md` is done or decided;
- our own scanner finds 0 findings on our public address: HTTPS, redirect, all five headers, no third-party requests, the three legal links;
- three real checks run end to end on production, and one lead arrives through the form;
- the legal pages have been reviewed by a native speaker.

When the site is announced is Fedor's decision.

</goal>

<owner_decisions_stage_c>

- 26.11.2026: bot protection is ALTCHA, the open-source proof-of-work captcha (MIT licence), self-hosted on our own Workers. Not Cloudflare Turnstile: Turnstile loads a script from another host on our pages, which brief v1 forbids ("no third-party requests from our own pages") and which our own scanner would report. ALTCHA protects the start of a scan and the lead form. Only the open-source version: no ALTCHA Cloud, no Sentinel.
- 26.11.2026: the lead form is part of version 1 (not a mailto link). Fedor answers leads only by e-mail (19.11.2026); the form says so.
- 26.11.2026: reports are kept for 30 days, then deleted.
- 26.11.2026 (proposed): leads are kept in D1 for 30 days, then deleted. Fedor's e-mail correspondence is his own record.
- 26.11.2026 (proposed): pages and components that are not designed (legal pages, "So prüfen wir", the German 404 page, the lead form, the pending state of the scan form) are built only from existing components and styles of the reference, as `<design>` in brief v1 says for undesigned states. Fedor reviews each before it is merged. No separate design work.
- Open, Fedor decides before C5: the channel for lead notifications and the address of the site.
  - (a) Fedor registers a domain and moves its DNS to Cloudflare. Email Routing gives a contact address on that domain; the API Worker sends each lead to Fedor's verified address with the visitor as Reply-To (sending to verified destination addresses is free on every plan); the site can run on a subdomain.
  - (b) Without a domain: the site stays on `website-check.devbyfedor-dev.workers.dev`; a Telegram bot sends Fedor only "Neue Anfrage" with the lead number and no personal data, and Fedor reads the lead with one wrangler command.
- Personal data of the owner (name, postal address, contact e-mail for the Impressum) never appear in session messages. The pages read them from one file that Fedor fills in and commits himself.

</owner_decisions_stage_c>

<standard_checks>

"The standard checks" in this file means all of these, run one after the other on the final code of the session:
- `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run build:web` pass;
- `npm run check:report` and `npm run check:scan`: 0 problems;
- `npm run visual`: pages the session did not change differ by 0 pixels; `npm run motion` and `npm run a11y` pass;
- 0 requests from our pages to other hosts; 0 CSP violations in the console;
- leak search with the full list of strings, the rule of review finding 93 in `docs/progress.md` and in the commit messages, `git ls-files local` empty.

</standard_checks>

<sessions>

Each session takes one to two hours, works on its own branch from `main` and ends with a report in Russian. A session that changes what visitors see is not merged until Fedor has looked at it; the merge is then the first step of the next session. A session without visible changes merges at its end when its condition holds.

### C1: measurements on Cloudflare (done, 26.11.2026)

Parallel tabs, a flood page beside a delayed tracker, the error of a refused connection, CPU of the quick check's HTML reader, CPU of status and cancel, the country of the visit on a real report. Numbers in `docs/measurements/c1.md`.

### C2: fixes from C1 (done, 26.11.2026)

The false end of the day after a refused browser launch, the memory of the HTML reader, the minimum observation time of a page.

### C3: bot protection and the scan form

- ALTCHA on the start of a scan. The widget is served from our own assets, never from a CDN. Invisible mode: the browser solves the challenge after "Website prüfen" is pressed. Challenges are created and verified in our Workers with an HMAC key from a Worker secret (locally in `.dev.vars`). A solved challenge is accepted once (a replay is refused) and expires after a few minutes.
- Difficulty: solving takes 0.3 to 1.5 s on the laptop with the CPU throttled 4× in Chrome (a slow phone).
- The pending state of the form ("Prüfung wird gestartet") while the challenge is solved and the start is answered, announced to screen readers. Undesigned state: built from existing components.
- Without JavaScript: a `<noscript>` line on the home page and on the scan screen (backlog).
- Visitor limits: keep 5 scans per hour and 15 per day, 20 starts per hour and 60 per day, unless a reason appears; give the cancel call and the status call a limit of their own (backlog). Record the result in `docs/decisions.md`.
- The CSP stays without `unsafe-inline` and `unsafe-eval`. If the widget needs a web worker, serve it as a file of our own; `blob:` only if there is no other way, with the reason in `docs/decisions.md`.

**Merge condition C3**
- the standard checks;
- tests: a start without a solution, with a wrong one, with an expired one and with a replayed one is refused; a valid one is accepted once;
- our scanner on our local site (`npm run self-scan`): 0 third-party requests, axe 0;
- solving time within 0.3 to 1.5 s as above, median of 10 runs;
- not merged until Fedor has looked at the pending state.

### C4: legal pages and retention

- Impressum (§ 5 DDG), Datenschutzerklärung and Erklärung zur Barrierefreiheit for our own site, linked from the footer, built from existing components.
- The Impressum values come from one owner file (for example `web/content/owner.json`) that Fedor fills in himself. Until then it holds clear placeholders, and the production build fails while a placeholder is left.
- The Datenschutzerklärung describes what the service really does, taken from the code and the docs: hosting and processing on Cloudflare (Workers, the Durable Object in the EU jurisdiction, D1, Browser Run, and that the browser runs in data centres in different EU countries); the addresses visitors enter and the reports (cache 24 hours, kept 30 days); the visitor hash (HMAC with a daily salt, pseudonymous, its life of one day; backlog); ALTCHA (no third party, no cookies); the lead form (fields, purpose, legal basis, kept 30 days, the notification channel); no cookies and no analytics; the rights of data subjects and the competent supervisory authority. It is a draft, not legal advice, and is marked as a draft in `docs/content-drafts.md`.
- The Erklärung zur Barrierefreiheit is a voluntary statement: the WCAG 2.1 AA target, what our checks measured (axe-core, keyboard, contrast, Lighthouse), known limits, a contact.
- Retention: a daily cron deletes reports and leads older than 30 days (`purgeBefore`, backlog), with tests.

**Merge condition C4**
- the standard checks;
- `npm run self-scan`: all three legal links found, no manual check left for them;
- a test shows that the production build fails with a placeholder left in the owner file;
- tests of the purge: rows older than 30 days are deleted, newer rows stay;
- not merged until Fedor has looked at the three pages.

### C5: lead form and notifications

Needs Fedor's decision on the channel (owner decisions above).

- The form, built from existing components: Name, E-Mail, Website (filled in from the report), Nachricht; ALTCHA; a line that the answer comes by e-mail; a link to the Datenschutzerklärung. Success and error states. "Hilfe bei der Umsetzung anfragen" on the report leads to the form with the report link. The printed report shows the address of the form (backlog).
- One call in the API Worker: validation, a visitor limit of its own, the lead in the D1 table `leads`, the notification through the chosen channel. Secrets only as Worker secrets. If the notification fails, the lead stays in D1 and the error is logged without personal data.

**Merge condition C5**
- the standard checks;
- tests for validation, the limit, a replayed ALTCHA solution and a failed notification;
- end to end on local `wrangler dev`: form → row in D1 → notification call (faked locally);
- not merged until Fedor has looked at the form and its states.

### C6: "So prüfen wir", 404 and small pages

- "So prüfen wir" in plain words: only the homepage and the Impressum; no interaction, so scripts delayed until the first click are not seen (backlog); the minimum observation time from C2 and trackers that load later; the country of the browser and why it varies; the six accessibility rules are not a full audit.
- The German 404 page; description meta tags for the home page and the BFSG page; the links `#methode` and `#agenturen` lead to their targets.

**Merge condition C6:** the standard checks; not merged until Fedor has looked at the pages.

### C7: texts and statements about the law

- Every statement of the BFSG page about the law is checked against its source and recorded in `docs/rules-sources.md` (backlog item of B5 part 1); corrections are drafts.
- The short names of the 95 services are checked against the brands' own pages.
- The sentence "Zu jedem gibt es eine Anleitung für {System}" appears only when every finding of the report has steps for that system; otherwise an honest variant (draft).
- Findings that depend on the browser's country (backlog): wording.
- Jimdo keeps the general text unless its steps can be verified.
- A review package for the native speaker: one file with every German text of the site and of the drafts, grouped by page, each with a short note in English on what it says and where it appears.

**Merge condition C7:** the standard checks; tests: no forbidden word, every text id has a text; merged at the end.

### C8: quality check of the scanner

- A fresh local run of the 30 sites with the final code (homepage and Impressum only).
- A blind manual check of a fresh sample of 10 sites: 0 false positives in legal findings.
- Accessibility results compared with Lighthouse and with pa11y (HTML_CodeSniffer, free and local) instead of WAVE, which has no free automated use. Every difference explained.
- Impressum fields: the miss rate of the templates on the fresh run. The Claude API stays off if at most 5 % of the fields present on the pages are missed.

**Merge condition C8:** numbers in `docs/measurements/c8.md`; 0 false positives; the standard checks; merged at the end.

### C9: deploy preparation

- Production configuration: the D1 binding with the id Fedor creates, all migrations in order, the cron triggers, the list of secrets, the address by Fedor's decision.
- A step-by-step runbook in Russian for Fedor (Windows cmd, one command per step): create the D1 database, apply the migrations, set the secrets (`RATE_LIMIT_SECRET`, the ALTCHA key, the notification secret), deploy the scan Worker, then the API Worker, then check.
- Lab measurements on Cloudflare, only for what changed since C1, with the lab rules of stage A: API Worker CPU of the start with ALTCHA, of the lead call, of status and cancel (at most 8 ms on every request); three tabs in one browser with our own deterministic fixture pages (no sites from the list). Browser at most 2 minutes.

**Merge condition C9:** dry-run builds of both Workers pass; the standard checks; the lab deleted and its absence checked; merged at the end.

### C10: after Fedor's deploy

Fedor deploys by the runbook. Then:
- our scanner on the public address: HTTPS, the redirect from http://, all five headers counted, 0 findings;
- three real checks of sites from the list on production (browser at most 2 minutes) and one lead through the form, with the notification arriving;
- the console of Chrome stable on every public page: 0 CSP violations, Permissions-Policy warnings noted;
- Lighthouse on the live pages.

**Merge condition C10:** numbers in `docs/measurements/c10.md`. Fixes, if any, go to a follow-up session.

### C11: corrections after the native speaker's review

When the review is back: apply the corrections, the standard checks, merge after Fedor has looked.

</sessions>

<boundaries_stage_c>

- Lab Workers and a lab D1 only when the session message allows them, under the lab rules of stage A, deleted at the end with their absence checked.
- The production deploy is Fedor's. The agent never deploys production and never creates the real D1 database.
- No paid service and no trial: ALTCHA open source only.
- Test sites as in brief v1. If the harness refuses further visits to a site from the list, do not work around it.
- Legal texts are drafts and are never presented as final or as legal advice.
- The owner file with the Impressum values is filled in and committed by Fedor himself.

</boundaries_stage_c>
