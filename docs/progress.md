# Progress

## Current state

**25.11.2026:** stage A is finished (A1 to A5 and the polishing sessions fix-a1 to fix-a6, all merged). Stage B is in progress: B1 is merged (05f9370), B2 is merged (d86a6c3, in B3 part 1). B3 runs in two parts on branch `b3-report`, **not merged**: part 1 (the upper part of the report with the example JSON) is done; part 2 builds the report for a real id and its states without design, then merges. The paragraph below describes stage A.

After stage A a review found 102 points (Fedor, 23.11.2026: the polishing by the review comes first, then B1). Session fix-a1 fixed the four most serious ones about the honesty of the report, session fix-a2 (24.11.2026) the findings 18 to 24, session fix-a3 (24.11.2026) the findings 5, 6, 7, 14, 15, 16 and 71 to 74 about the Impressum and the legal links, session fix-a4 (24.11.2026) the findings 4 and 8 to 13 about limits and heavy pages with the small findings 25, 51, 54 and 61, session fix-a5 (24.11.2026) the findings 31, 32, 42, 44, 46, 47, 49, 50, 80, 89 to 91, 93 and 100 about privacy, the browser budget and the queue; all five are merged into `main`; the others follow in the sixth and last polishing session. Stage A, sessions A1 to A5 are merged into `main` (A5 in five parts, merged after part 5 on 23.11.2026). A5 runs in three parts on branch `a5-api` (Fedor, 22.11.2026): part 1, the SSRF protection, and part 2, the report schema, D1, the API, the cache and the rate limit, are done and not merged; part 3 builds the queue in the Durable Object, the Impressum tab on Cloudflare, the quick check, the end-to-end check and the merge. A4 added the mandatory information (Impressum and Datenschutz links, the Impressum in a second tab, its fields by templates, the Erklärung zur Barrierefreiheit) and system detection, locally; the Cloudflare adapter gets the second tab in A5. Part 3 was not merged (Worker CPU above 8 ms on 3 of 50 API requests); part 4 (23.11.2026) split the API Worker from the scan Worker and measured again: still not merged, the start of a new scan costs up to 19 ms (section "A5 part 4" below); part 5 (23.11.2026) moved the whole start into the queue object (Fedor's answer (a)): every API request at most 5 ms, merged (section "A5 part 5" below). Before the first push the history of all branches was rewritten twice to remove personal details about the owner (21.11.2026 and 22.11.2026, sections "History cleanup before the first push" and "Second history cleanup" below); commit hashes changed, nothing else. Fedor chose the plan after A2 (21.11.2026): the checks run in a Durable Object in the EU jurisdiction with strategy (a), the Worker only accepts the job and passes it on. A3 added the accessibility checks (pinned axe-core) and the security checks. Session A2 (measurement on Cloudflare) ran on branch `a2-cloudflare` in three parts (Fedor's decisions of 21.11.2026):
- Part 1 (done): the Cloudflare capture adapter in `worker/` with both strategies, and a check on three sites of whether consent tools behave the same with the Cloudflare browser as with the local run (banner, third-party requests before consent, browser location, Worker CPU and wall time).
- Part 2 (done): the capture moves into a Durable Object in the EU jurisdiction; the Worker only checks the token and passes the job on. The scanner recognises blocked pages (a web host's check page such as "Einen Moment bitte") and gives no findings for them. Check on Cloudflare: browser location from the Durable Object, the three sites of part 1 with both strategies, the blocked page recognised as blocked, CPU of the Worker and of the Durable Object.
- Part 3 (done): banner probe fixes, the measurement on 12 sites, `docs/measurements/a2.md` with the plan recommendation, the merge into `main`, and deleting the lab Worker.

Why three parts (Fedor, 21.11.2026): "Cloudflare did not stop any request" in part 1 is no proof. By the Workers limits page the free plan has only an allowance for occasional overruns of the 10 ms CPU limit; with constant overruns requests fail with error 1102. Part 1 measured 13 to 183 ms per page, so a capture in a plain Worker on the free plan does not fit. A Durable Object has 30 seconds of CPU per request by the limits table and is available on the free plan with SQLite storage only; part 2 checks whether the capture fits there before the 12-site measurement is planned on top of it.

## A1: project setup and the first check, locally (20.11.2026)

- Step 1: repository initialised. First commit on `main` contains only `design/` and `docs/brief.md`.
- Step 2: `.gitignore`, `.gitattributes`, `CLAUDE.md`, `docs/progress.md`, `docs/decisions.md`, `docs/backlog.md`.
- Step 3: npm workspaces `scanner/` and `worker/`, TypeScript 6.0.3 strict, Vitest 5.1.1, Node 24.15.0 pinned.
- Step 4: rules data for third-party services: 95 services with 224 host patterns (precedent 1, consent-required 17, usually-consent 14, grey-zone 47, not-flagged 16) and 132 sources in `docs/rules-sources.md`. A research pass with 12 helpers opened every source twice (research plus an independent attempt to refute it); none was rejected, uncertain classes went to grey-zone. Consent tool data: 21 tools with banner selectors.
- Steps 5 to 7: local Playwright capture adapter (Chromium, de-DE, Europe/Berlin, 1440 x 900, normal Chrome user agent, no interaction, network quiet or at most 15 s, banner probe), third-party analyzer, local runner (`npm run scan:local`) and explain tool (`npm run explain`).
- Step 8: 30 test sites in `local/sites.txt` (git-ignored): 12 online shops (4 Shopify, 4 WooCommerce, 4 Shopware), 12 small service businesses (3 craftsmen, 3 restaurants or inns, 3 practices, 3 agencies; 8 on WordPress, 4 on other systems), 6 sites on Wix (3) and Jimdo (3). All 30 are businesses in Bavaria. Research helpers proposed 62 candidates, each with one homepage fetch to confirm the system; a second helper checked each candidate and rejected 8 (a homepage with injected gambling spam, a chain with five stores, a shop that is not independent, a site without a shop, an owner that could not be verified, a hobby offer, an outdated Jimdo copy of another site, a second site on the same Jimdo free domain).
- Change of the test set (Fedor's decision, 20.11.2026): the first run had only 3 Google Fonts findings, the merge condition needs 5 checked findings. Two sites were therefore replaced on purpose by sites of the same group that link a Google Fonts stylesheet: one shop (a reserve candidate from the first research) and one craft business (from a second search: 48 homepages fetched once each, 6 candidates, all confirmed by a second reviewer). The replaced sites were the last ones of their group without any Google Fonts evidence. The mix stays 12 / 12 / 6, all in Bavaria. Because these two sites were chosen for Google Fonts, the share of sites with Google Fonts in this set (5 of 30) is not representative.

### Step 9: local run over the 30 sites

20.11.2026, Chromium 159, from Germany, homepage only, one visit per site (28 sites from the first run, the 2 replacement sites captured later the same day). Aggregated numbers, anonymous labels only.

- Captures: 30 of 30, no failures, no retries.
- Capture time per page: median 5.9 s, max 15.1 s. 22 pages stopped on a quiet network, 8 at the 15 s limit.
- Requests per page: median 74, max 471. Third-party requests per page: median 23, max 308.
- Consent banner seen on 19 of 30 sites, median 1.9 s after the start (shopware 3, generic heuristic 5, shopify 2, borlabs-cookie 2, complianz 2, usercentrics 2, wix 2, cookieyes 1). The manual check found at least 4 visible banners that were missed on the current set: two banners of the Shopify consent app Pandectes, which draws in a shadow root, one Cookie Notice bar lower than the heuristic's minimum height, and one Borlabs box that appeared only after the capture had ended (a Consentmo banner on a replaced site was missed too). Fixes are in `docs/backlog.md`. Banner timing never decides a finding.
- Sites with at least one finding: 11. With hints only: 13. With neither: 6. Sites with a finding that starts before the banner is visible: 6.
- Sites per risk class: precedent 5, consent-required 9, usually-consent 4, grey-zone hints 22, not-flagged 10. Unknown third parties on 17 sites.
- Most frequent services (sites): Google Tag Manager 8, Google Analytics 6, Google Fonts 5, reCAPTCHA 4, Shopify CDN 4, Shopify telemetry 4, Google Ads 3, Jimdo assets 3, Wix media 3, Wix platform 3, CCM19 2, Usercentrics 2, WordPress emoji 2, YouTube (privacy mode) 2.
- Consent signals: on both Usercentrics sites the tool reported no consent at the end of the visit, so it did not consent on its own.

### Step 9: manual check of Google Fonts

Done by hand in the saved captures (`npm run explain`, saved HTML, screenshots) and again by independent reviewers who tried to refute each result (9 reviews). No site was visited again for the check.

- 5 sites have a Google Fonts finding. All 5 are true positives, 0 false positives. In all five the requests were made in the top-level document, got a response, and came from the site itself: form fonts of a newsletter app the shop installed (style element injected at runtime), the custom-fonts link of a Shopify theme, the font list of a newsletter plugin, the font link of a site builder page, and the site's own WebFont configuration. On all five a consent banner was still open in the final screenshot, so no consent had been given.
- Google Fonts loaded inside Google's own embeds are attributed to those embeds and not reported as the site's Google Fonts: on 4 sites only inside YouTube (privacy mode) and reCAPTCHA iframes, and on one of the 5 sites three more requests inside the Google Maps and reCAPTCHA iframes next to the site's own Google Fonts. Checked: 0 wrong attributions.
- One site references Google-hosted emoji images that load only when scrolled into view; the scan never scrolls, so there is no request and no finding (a false negative by design, see backlog).
- Change after the check: an embedded product now owns only requests to its own provider (Google Maps loading Google Fonts). Google Fonts loaded by an app of another provider stay a Google Fonts finding, with the initiator in the evidence. Re-analysis of the saved captures (`npm run scan:local -- --reanalyze`, no new visits) confirmed the numbers.

### Merge condition A1

- `npm test` passes completely: 117 of 117 unit tests. The Playwright integration test (`npm run test:integration`): 10 of 10. `npm run typecheck`: no errors.
- At least 27 of 30 sites give a capture: 30 of 30, no failures.
- 0 false positives in the manual check of 5 sites: 5 Google Fonts findings checked, 0 false positives (plus 5 related cases of Google Fonts inside embeds, 0 wrong attributions).
- `git ls-files local` is empty: yes.

Result: merged into `main` with `git merge --no-ff`.

## A2 part 1: Cloudflare adapter and the consent check on three sites (21.11.2026)

Branch `a2-cloudflare`, not merged (part 2 merges). The session took about 1 hour 10 minutes. Browser time on Cloudflare: 40.6 s (0.68 browser minutes) by Cloudflare's own counter (`usedBrowserTimeSeconds`), the same as the two sessions in the history (31.3 s and 9.3 s, both closed normally). The limit for the step was 3 minutes.

### What was built

- Cloudflare capture adapter in `worker/src/capture/` with the Browser Run binding and `@cloudflare/puppeteer` 2.0.1 (Chrome 152, the same as Browser Run). It returns the same `Capture` as the local adapter (`adapter: cloudflare-browser-run`, new optional field `strategy`).
  - Strategy (a) `cdp-events`: request events through the browser protocol, like the local adapter.
  - Strategy (b) `resource-timing`: its own tab without network events; all requests come from one Resource Timing call in the page; status, headers and redirects of the main document from document interception.
- Same visitor as the local run: `de-DE`, `Europe/Berlin`, 1440 x 900 window and screen, desktop Chrome user agent on Windows with the same client hints and `navigator.platform` `Win32`, focus emulation. The values are shared in `scanner/src/capture/settings.ts`, the protocol commands copied from Playwright in `worker/src/capture/emulation.ts`.
- Lab endpoint `worker/src/lab/` behind a token from `worker/.dev.vars` (open session, trace page, capture, close, limits), driver `npm run lab:cloudflare`, local fixture site, capture comparison, filter for `wrangler tail`.
- Debugged on plain `wrangler dev` with the local Chrome against the fixture site, 0 Cloudflare minutes: strategy (a) gave the same 13 requests as the local adapter; the fixture server got the same `Accept-Language`, client hints and user agent from all three; inside a cross-site iframe all three saw `Europe/Berlin`, `de-DE` and `Win32`; 300 images (more than the browser's buffer of 250) were all captured by both strategies.
- An independent review before the run found 4 important and 4 minor problems; all were fixed before the run (time zone and language missing in out-of-process iframes in strategy a, left-over tabs after a terminated request, a browser budget per script run instead of per step, dev switches, host checks, timeout wording, platform).
- Lab Worker `website-check-lab` deployed to workers.dev (allowed by Fedor for the CPU measurement): only the measurement endpoint, Workers Logs off, no preview URLs, token secret set from `.dev.vars`. It is deleted after part 2.
- `npm test`: 170 of 170. `npm run test:integration`: 10 of 10. `npm run typecheck`: no errors. `git ls-files local` is empty; the token is in no tracked file and nowhere in the git history.

### Result on Cloudflare (Worker and browser both on Cloudflare)

- Where the browser runs: both sessions `loc=NL`, `colo=AMS` (Amsterdam), not Germany. Inside the page the emulation held: Windows user agent, `de-DE`, `Europe/Berlin`, `Win32`, 1440 x 900, focus.
- Sites: three sites with three different consent tools where the local run sees the banner. Each with both strategies, then at once locally.
- One more site, chosen first, does not let the Cloudflare browser in: its web host answers with a bot check page ("Einen Moment bitte …", HTTP 200) and the check did not pass; locally the site loads normally. It was replaced by one of the three sites above in a second, short browser session. Our classifier counted the check page as a captured page (gap, see backlog).
- Banner: seen on Cloudflare in 6 of 6 captures of the three sites, with the same tool as locally. It became visible earlier than locally (0.7 to 1.7 s on Cloudflare, 1.4 to 2.1 s locally). Usercentrics loaded the same German GDPR settings as locally and reported no consent at the end (`allAccepted: false`) on Cloudflare too.
- Third-party requests before consent: the set of third-party hosts is the same as locally in 6 of 6 captures (0 hosts only on Cloudflare, 0 only locally). Strategy (b) has exactly the local number of third-party requests (60, 33, 0). Strategy (a) has more on two sites, checked one by one: one more on one site, three more on the other. All of them are CORS preflight requests (`OPTIONS`) to the same hosts right before requests that the local run has too (a consent API, a telemetry host). Puppeteer reports preflights as their own requests, Playwright does not: a difference of the adapters, not of the sites. The third site has 11 more first-party entries in (a), all `data:` images and one SVG fragment that Playwright does not report.
- Findings: strategy (a) has the same findings as locally on all three sites. Strategy (b) has one finding less on one site (a tag manager request becomes a hint), because the page cannot see the HTTP status of cross-origin resources.
- Completeness (requests by host and path, compared with the local capture made right after): (a) 97.9 %, 99.7 %, 100 %; (b) 97.9 %, 99.0 %, 100 % (Site 10, Site 04, Site 14). Strategy (b) misses requests inside iframes and requests still open at the end.
- Worker CPU time per page (from `wrangler tail`): (a) 93 ms, 183 ms, 34 ms; (b) 21 ms, 20 ms, 13 ms (Site 10, Site 04, Site 14). The blocked check page of the replaced site cost 14 ms and 13 ms. Opening the browser 8 and 5 ms, trace page 28 and 16 ms, closing 3 and 2 ms. No capture stayed within the 10 ms of the free plan, also not strategy (b), but Cloudflare did not stop any request (every outcome `ok`, no `exceededCpu`). Even the blocked page with 2 requests costs 13 ms in (b), so most of (b) is a fixed cost of connecting and preparing the tab.
- Worker wall time per page: (a) 3.4 s, 6.8 s, 3.8 s; (b) 4.5 s, 8.3 s, 4.3 s. Network events handled by the Worker in (a): 429, 918, 249; in (b) 2 to 4 events plus 11 to 26 in-page polls.
- Other: one of the three sites had 5 findings in the A1 run on 20.11.2026; on 21.11.2026 it has none, locally and on Cloudflare alike. The other sites match their A1 captures and the integration test passes, so the site itself changed. It was one of the 5 checked Google Fonts sites of A1.

Answer to the main question of part 1: on the three sites that let it in, the Cloudflare browser saw the same banners and the same third-party hosts before consent as the local run from Germany, although it runs in the Netherlands. No site showed trackers that run only for the Cloudflare browser. One of four sites blocks the Cloudflare browser entirely.

## A2 part 2: capture in a Durable Object, blocked pages (21.11.2026)

Branch `a2-cloudflare`, not merged (part 3 merges).

### What the documentation says (checked 21.11.2026, every statement re-checked by a second reader: 138 of 138 confirmed)

- Cloudflare's guide "Deploy a Browser Run Worker with Durable Objects" (developers.cloudflare.com/browser-run/how-to/browser-run-with-do/): the Durable Object launches the browser with `puppeteer.launch`, keeps it in memory between requests, reuses it while it is connected, closes it with an alarm after 60 s without use; SQLite class through `new_sqlite_classes`; the Worker passes the request to one object with `fetch`.
- Durable Objects on the free plan: SQLite storage only; "CPU per request: 30 seconds (default)", reset by every incoming HTTP request; no wall-time limit while the caller is connected; 100,000 requests and 13,000 GB-s per day (durable-objects/platform/limits/ and /pricing/). The same limits page also says "Workers limits also apply", and the Workers free plan has 10 ms, so the docs do not settle the free CPU limit of a Durable Object; the experiment below does.
- Workers limits page: "Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit. If your Worker starts hitting the limit consistently, its execution will be terminated", with error 1102 and the outcome `exceededCpu`.
- Jurisdiction `eu` (durable-objects/reference/data-location/): the object "only runs and stores data" in the EU; created with `namespace.jurisdiction("eu")`; no plan restriction is documented. It says nothing about where a browser started from such an object runs; the Browser Run FAQ says only "close to the incoming request".
- Quick Actions (browser-run/quick-actions/ and the API reference of every endpoint): none returns the requests the page made (no request list, no HAR, no status or timing of subresources; the only request options block or allow requests). Several endpoints (`/content`, `/snapshot`, `/links`, …) return the status and headers of the main document in `meta`. So Quick Actions cannot capture third-party requests; as Fedor decided, they are not measured (plan B is out for the capture).

### Step 1: CPU in the Durable Object without a browser

The lab Worker (redeployed) passes `/lab/cpu` to the Durable Object `LabBrowser` in the EU jurisdiction, which runs a fixed number of xorshift steps (the clocks stand still during computation, so the load is a number of steps). CPU and wall time from `wrangler tail`:

- 1.1 billion steps: Durable Object CPU 4,964 ms, wall 5,162 ms, outcome `ok` (1.6 s on the laptop: Cloudflare ran this loop about 3 times slower).
- 330 million steps, three times in a row: CPU 1,485 ms, 1,494 ms and 596 ms, outcome `ok` each time.
- The Worker in front of it: CPU 0 to 1 ms on all six requests. Outcome `ok` on the first two; `canceled` on the three requests of the loop, although the client got the full answer (HTTP 200, the right checksum). `canceled` is not a CPU stop (that is `exceededCpu`); the driver process exits right after reading the answer, which may close the connection before the Worker's event ends (a guess, checked again in step 4).

Result: a Durable Object on the free plan ran 1.5 s and 5 s of CPU in one request without being stopped, 150 to 500 times the 10 ms of a Worker.

### Step 2: capture inside the Durable Object

- `worker/src/lab/`: the Worker (`createLabGate`) checks the token and passes the request on unchanged in URL and body, without the authorization header, to the Durable Object `LabBrowser` in `LAB_BROWSER.jurisdiction("eu")`; the answer goes back unparsed. The object (`createLabRoutes`) runs the same routes as in part 1 (limits, session, trace, capture, close) plus `/lab/cpu`. As in Cloudflare's guide it keeps the browser in memory and reuses it while it is connected; an alarm closes a browser that got no job for 30 s, the browser's own idle timeout is 10 s. Local `wrangler dev` has no jurisdictions, so only there (dev switch and loopback address) the plain namespace is used.
- Both strategies unchanged, same `Capture` format. Strategy (a) now sends a harmless command every 3 s while it waits, so the kept browser is not closed as idle on a page that runs to the 15 s limit.
- Debugged on plain `wrangler dev` with the local Chrome against the fixture site, 0 Cloudflare minutes: the same requests as in part 1 (strategy a 13 of 13, strategy b 9 of 13, 300 of 300 images in both), the same language, time zone and platform in a cross-site iframe.

### Step 3: blocked pages

- `scanner/src/capture/failure.ts`: a check page of a web host with HTTP 200 (or 503) is `blocked` (rule and reason in `docs/decisions.md`): almost empty page and either a whole "please wait" title or a sentence that the request or the browser is being checked. Both adapters pass title, text, links and the number of requests.
- `scanner/src/analyzers/capture.ts`: `analyzeCapture` is the one entry point of the analysis; a blocked or failed capture gives its state and no analysis, so no findings. Saved captures are decided again (`recheckCapture`); the local runner, the comparison and `explain` use it.
- Tests on synthetic samples only (no real names): 9 check pages recognised, 11 normal pages kept, among them a homepage with a "Bitte warten" phrase, a thank-you page, a Kfz page titled "Sicherheitsprüfung & HU …" and a redirect page; a blocked capture with a tracker request gives no findings, the same requests on a normal page give the finding.
- On all 72 saved captures (A1 and A2), no site visited: exactly the 2 Cloudflare captures of the blocked site from part 1 change to `blocked`, the other 70 stay as they were.
- An independent review of steps 2 and 3 before the run found 2 important and 6 minor problems; all were fixed before the run (the title rule was too broad, no browser cap per run, idle closing in strategy a, labels without the run, titles on the console, `explain` and old result files).

### Step 4: check on Cloudflare (one browser session, 21.11.2026, 13:17 to 13:18)

- Browser session: 32.9 s by Cloudflare's history (open to close, `NormalClosure`), one session for the trace page and 8 pages; every page reused the kept browser (no reconnect, no left-over tab). The limit for the step was 2 minutes.
- Where things run: the Durable Object reports the jurisdiction `eu` and `colo=MXP` (Milan) for its own request to the trace page (its `loc` shows `DE`; what `loc` means for a request made by an object is not documented). The browser it started: `loc=IT`, `colo=MXP`. Part 1 (browser started from a plain Worker) had `loc=NL`, `colo=AMS`. So the browser runs in the EU, but not in Germany, and the place can change between sessions. Inside the page the emulation held: Windows user agent, `de-DE`, `Europe/Berlin`, `Win32`, 1440 x 900, focus.
- The three sites of part 1, both strategies, compared with the part 1 capture of the same site and strategy: the set of third-party hosts is the same in 6 of 6 (0 only now, 0 only then), the findings are the same in 6 of 6, the banner is the same tool in 6 of 6. Request counts: exactly as in part 1 on two of the sites, 297 and 299 instead of 301 and 306 on the third (dynamic requests, same hosts).
- The blocked site of part 1 was not blocked this time: from Milan its web host let the browser in, and both strategies captured the real homepage (90 and 108 requests). The scanner therefore correctly treated both captures as normal pages. Recognition of the check page was shown on the two saved captures of part 1 (both `blocked`, no findings). Compared with the local capture made right after: strategy (a) has the same third-party hosts and the same 2 findings; strategy (b) shows both only as hints (the known hidden status) and has 3 hosts more and 1 less, among them `www.google.it`: Google chose the Italian domain for the browser in Italy.
- CPU and wall time from `wrangler tail`, outcome `ok` on all 28 events (14 of the Worker, 14 of the Durable Object, including one small CPU request that checked the log stream):
  - Worker: 0 ms CPU on every request (trace, 8 pages, open, close, limits).
  - Durable Object per page: strategy (b) 17, 12, 17, 10 ms CPU, wall 3.6, 4.1, 5.7, 4.0 s; strategy (a) 93, 65, 204, 45 ms CPU, wall 2.7, 3.1, 5.6, 3.4 s (Site 10, Site 06, Site 04, Site 14). Trace page 19 ms, opening the browser 8 ms, closing 1 ms.
  - The Durable Object was never stopped; its largest page (204 ms) is below 1 % of the 30 s per request.
- Worker outcome `canceled` from step 1 did not appear: this time one driver process sent all requests over one connection, which fits the guess that the short-lived driver process closed the connection early.

### Merge condition of part 2 (no merge in this part)

- `npm test` passes completely: 208 of 208 unit tests. `npm run test:integration`: 10 of 10. `npm run typecheck`: no errors.
- CPU of the Worker on every request at most 8 ms: yes, 0 ms on all 14 Worker events of the run (and 0 to 1 ms in step 1).
- The Durable Object never stopped: yes, outcome `ok` on all 14 object events of the run and all 5 of step 1.
- At most 2 browser minutes for step 4: 32.9 s. Browser time of the day: 73.5 s of 600 (part 1 40.6 s plus 32.9 s); Cloudflare's `usedBrowserTimeSeconds` lags and still showed 40.6 s right after the close.
- Blocked page recognised as blocked: not possible live, because the site did not block the browser this time; recognised on the 2 saved check pages of part 1.
- `git ls-files local` is empty; no token in any tracked file.

Session time: about 45 minutes (12:37 to 13:22). Browser minutes in this session: 0.55 (32.9 s), all in step 4; steps 1 to 3 used none.

## A2 part 3: banners, 12 sites through the Durable Object, report, merge (21.11.2026)

Fedor's changes to the plan of part 3 (21.11.2026, before the start):
- Strategy (b) is not measured on the 12 sites: it lost findings twice (one finding on one site in part 1, two findings on another site in part 2 became hints), and its CPU saving is not needed inside a Durable Object. The report uses its numbers from parts 1 and 2.
- Google's domains of different countries (for example `google.it` and `google.de`) belong to one service in the scanner: the Cloudflare browser runs sometimes in the Netherlands, sometimes in Italy.
- The A2 report says how many full checks per day the free plan allows and which limit runs out first.
- Answers before the start: (1) yes, the capture stays in the Durable Object with 30 s CPU per request on the free plan (three confirmations, see `docs/decisions.md`); (2) the site that blocked the browser in part 1 is one of the 12 sites, once in the common run, not repeated.

### Step 1: banners (about 15 minutes, 13:45 to 14:00; limit 45)

- Why banners were missed (saved screenshots of A1 plus one debug visit of five homepages, no interaction): two Shopify consent dialogs (Pandectes) and one top bar of a site builder's consent banner are drawn inside an open shadow root whose host element has no size, so the probe saw only an empty host; a Cookie Notice bar (70 px, classes `cn-bottom bootstrap`) sat below the lowest probe point and did not match the narrow selector. The Borlabs box of A1 loads lazily and appeared after the capture had ended.
- Fix in `scanner/src/consent/probe-script.ts` (shared by both adapters): the heuristic follows a hit into open shadow roots and back out through the host, reads `aria-label`, checks two more points 3 % from the top and bottom edge, and accepts bars from 36 px; a bar lower than 100 px must mention cookies or consent outside its links and buttons. Cookie Notice is found by `#cookie-notice`.
- Tests: five fixture pages in the Playwright integration test (shadow dialog, shadow top bar, 40 px bottom bar, Cookie Notice bar, and a page of look-alikes under the probe points: header and footer bar with a cookie link, a small settings box, a reopener with an aria-label, a newsletter popup, a hidden bar). With the old probe the five tests fail, with the new one they pass; without the rule for low bars the look-alike test fails.
- Check on the 30 sites: a new local run (homepages only, into `local/a2/banner-run/`, the A1 captures stay as they were), then six independent reviewers looked at the 30 new screenshots without knowing the scanner's result. A banner is visible on 23 screenshots and the probe recognised 23 of 23 (before: 19 detected); no banner is visible on 7 and the probe reported none (false banners: 0). Reasons for the 7: two sites show only a small button to reopen the cookie settings, one page showed only a loading spinner when the network went quiet, one consent tool was in the page but did not show its box within the capture, three sites have no banner.
- After the review fixes (low bars), all 8 banners found by the generic heuristic on the 30 sites are higher than 200 px, so the new rule does not change the check.

### Step 2: Google country domains

- `scanner/data/google-domains.json`: Google's 186 country search domains (https://www.google.com/supported_domains). Matching and the grouping of unknown hosts map a host on any of them to the same host on google.com; the rules data names only google.com. The comparison of captures uses the same mapping.
- Re-analysis of the saved captures without visiting any site: 0 of 30 sites change in the A1 set (which has requests to `www.google.de`) and 0 of 30 in the new local set.

### Step 3: the measurement on Cloudflare (14:17 to 14:21)

- Lab Worker redeployed with the new probe (allowed by the session message). An independent review of steps 1 and 2 before the run found 5 real problems (2 important in the capture comparison: a real POST taken for a CORS preflight, `data:` URLs counted as missing locally; 3 minor: footer bars with a cookie link, a look-alike test that did not test what it said, `explain` without the Google mapping); all were fixed before the run.
- Session 1: trace page and 12 sites (Site 10, 23, 06, 04, 14, 13, 03, 11, 19, 26, 28, 30), strategy (a), through the Durable Object. The 12 are 5 shops, 4 service businesses and 3 site builders. 57.5 s of browser time. Browser `loc=IT`, `colo=MXP`; object jurisdiction `eu`.
- No page ran to the 15 s limit on Cloudflare, so session 2 captured two more pages (18.4 s): one stopped at 15,031 ms, the browser lived to the end, the next page reported `reconnected: false`, the session closed normally.
- Right after each session the same sites were captured locally.
- Per site numbers and the plan comparison: `docs/measurements/a2.md`. In short: Worker CPU 0 to 1 ms; Durable Object CPU per page median 43 ms, max 334 ms; object wall median 3.5 s, max 11.6 s (15.3 s on the 15 s page); 48 of 48 events `ok`; one site blocked by its own Cloudflare protection (no findings); banner the same as locally on 11 of 11 sites that let the browser in; completeness median 99.0 %, minimum 91.7 %, without 17 CORS preflights and 56 `data:`/`blob:` URLs; findings the same on 10 of 11.
- One site has one finding more on Cloudflare: the analytics tag sent Google signals requests (`stats.g.doubleclick.net`, `www.google.it/ads/ga-audiences`) to the browser in Italy (2 of 3 Cloudflare captures), never in 5 local captures from Germany. The requests are real, but depend on the country of the browser.
- Browser time: 75.8 s for the step (limit 3 minutes); 149.4 s of the day's 600 s (parts 1 and 2 used 73.5 s).

### Step 4: report

- `docs/measurements/a2.md`: per-site numbers, plans A, B, C and the Durable Object compared, recommendation, capacity of the free plan (first limit: Browser Run's 10 minutes per day, about 60 full checks of homepage and Impressum per day at the measured mean, 79 at the median, 19 in the worst case), paid options only as a note.

### Merge condition of A2

- `npm test` passes completely: 221 of 221 unit tests. Also `npm run test:integration` 15 of 15 and `npm run typecheck` without errors.
- No secrets in git: the lab token is in no tracked file, in no commit of any branch and in no commit message (checked with the value from `worker/.dev.vars`, not printed).
- No addresses or names of the test sites in git: none of the 32 domains of `local/sites.txt` and `local/sites-v1.txt`, and none of their names without the ending, in the tracked files, in any commit or in any commit message. `git ls-files local` is empty.

Result: merged into `main` with `git merge --no-ff` (merge commit 56a9455; it was 0dca8ef before the history cleanup of 21.11.2026 and cc34dbc before the second one of 22.11.2026); this record follows in a second merge.

### Step 5: lab Worker deleted

- `npx wrangler delete -c worker/wrangler.lab.jsonc`: "Successfully deleted website-check-lab" (with a warning that wrangler could not check for Container applications, which the lab never used).
- Check: the workers.dev address answers HTTP 404 with Cloudflare error 1042 (no Worker there), and the API answers "This Worker does not exist on your account" (code 10007). `LAB_TOKEN` is removed from the local `worker/.dev.vars`.

Session time: about 45 minutes (13:45 to about 14:30). Browser time in this session: 75.8 s (1.3 browser minutes), all in step 3; steps 1, 2 and 4 used none. Browser time of the day: 149.4 s of 600.

## A3: accessibility and security checks (21.11.2026)

Branch `a3-a11y-security`. Session time: about 1 hour 15 minutes (14:35 to about 15:50). Browser time on Cloudflare: 52.6 s (0.88 browser minutes), all in step 6; browser time of the day 202 s of 600 (A2 used 149.4 s).

Fedor's answers before the start (in `docs/decisions.md`): the plan is the Durable Object in the EU jurisdiction with strategy (a), which changes the architecture section of the brief (noted there); findings that depend on the country of the visit stay findings, the country is stored with every capture and named in the report (the field in the report schema is a backlog item for A5); the lab Worker may be deployed again for the Cloudflare check.

### What was built

- Step 2, axe-core: `axe-core` 4.14.1 pinned in `scanner/` and `worker/` (`@axe-core/playwright` 4.14.0 with the same axe-core for the reference). `scanner/src/a11y/`: the seven rules (`color-contrast`, `image-alt`, `label`, `link-name`, `button-name`, `html-has-lang`, `html-lang-valid`) on the top-level document, `iframes: false`, `preload: false`; a reporter in the page groups with axe's own `aggregateResult` and returns counts per rule (violations, incomplete, passes) and at most 5 examples (selector path, HTML up to 200 characters, contrast values), the lowest contrast and the frames of the page. Both adapters inject the same source after the page snapshot, only on a captured page, within the 20 s hard limit (at most 8 s); the Worker bundles `axe.min.js` as a text module. Analyzer `analyzeAccessibility`: the six error types of the brief, "bitte manuell prüfen" for undecided elements (also next to violations), "nicht geprüft" when axe did not run, a rule threw, or the content sits in frames.
- Step 3, security without a browser: `scanner/src/security/http-probe.ts` checks the redirect from http:// to https:// with `fetch` and manual redirects (at most 5, 10 s, ports 80 and 443, the Durable Object's host check on every hop), in parallel with the page load; HTTPS and the five headers come from the main document the browser loaded. Analyzer `analyzeSecurity` with the header rules of the standards (HSTS only on HTTPS, CSP and referrer by meta tag count, Permissions-Policy parsed as a structured field, report-only and Feature-Policy apart, "bitte manuell prüfen" when the meta tags are unknown).
- Step 4, fixture pages: 15 pages in `scanner/fixtures/a11y/` (a page with errors and one without for every rule, plus a mixed homepage with an open shadow root and a hidden menu), expected counts in `expected.json`, written by a helper and confirmed by an independent helper with plain `axe.run`. 36 German draft texts in `docs/content-drafts.md`, every one "Status: Entwurf"; an independent review found 22 problems, all fixed.
- Step 5, local run of 30 sites and the comparison with a standard axe-core run on 5 sites (`npm run scan:local -- --axe-reference ...`): numbers in `docs/measurements/a3.md`.
- Step 6, Cloudflare: the lab Worker deployed again, 5 sites through the Durable Object with all checks, then deleted.
- An independent review before the Cloudflare run (3 reviewers, every finding checked by a skeptic) confirmed 6 problems (11 rejected); all 6 were fixed before the run (undecided elements next to violations, frameset pages, rule errors inside axe, Permissions-Policy parsing, unknown meta tags, addresses in error texts of the summary).

### Numbers

- Local run of the 30 sites: 30 of 30 captured, axe `ok` on 30 of 30, time for axe per page median 0.19 s, max 0.47 s. Violations on 25 of 30 pages; text contrast on 22 sites (191 elements), empty links on 11 (66), images without alternative text on 2 (28), empty buttons on 2 (7), form fields without labels on 1 (8), page language on 1 (1). HTTPS and the redirect from http to https on 30 of 30. Headers present: HSTS 20, CSP 7, X-Content-Type-Options 14, Referrer-Policy 5, Permissions-Policy 0 of 30; per site median 1 of 5.
- Comparison with the standard run on 5 sites (Site 03, 06, 10, 14, 26). The five sites have five different systems. In the first run 4 of 5 the same; on one site, a page still loading at the 15 s limit, one image appeared between our run and the standard run (our second run gave the standard count). After the change to a comparison on a stable page (ours, standard, ours again, until our two runs agree), a new visit of the 5 homepages: 5 of 5 sites the same on every rule (35 of 35 rule results, 73 violations), also the first five selectors; incomplete counts the same on 4 of 5 (one site: 56 and 57, carousel; not part of the condition).
- Cloudflare: browser in Vienna (`loc=AT`), object in the EU jurisdiction. Worker CPU 0 ms on every page request (1 ms on one limits request). Durable Object CPU per page 61 to 458 ms. 20 of 20 events `ok`. axe adds 0.68 to 1.65 s of browser time per page, mean 1.05 s. Session 52.6 s. Capacity of the free plan with axe on the homepage: about 54 full checks per day at the mean (A2: 60), 71 at the median, 16 in the worst case.

### Merge condition of A3

- `npm test` passes completely, with the fixture pages: 282 of 282 unit tests (among them the check of the fixture manifest); the fixture pages in Chromium (`npm run test:integration`): 37 of 37, all 15 pages equal to `expected.json` and to the standard run; `npm run typecheck`: no errors.
- On 5 sites the number of violations per rule equals the standard run exactly: yes, 5 of 5 sites, 35 of 35 rule results (second comparison on a stable page; the first comparison had 4 of 5, with the cause shown above).
- On Cloudflare the Worker's CPU at most 8 ms on every request: yes, at most 1 ms. The Durable Object never cut off: yes, 10 of 10 object events `ok`. At most 1.5 browser minutes for the whole step: 52.6 s.
- No token, addresses or names of the sites in git: the lab token is in no tracked file, no commit of any branch and no commit message (checked with the value, not printed); none of the 32 domains of `local/sites.txt` and `local/sites-v1.txt`, nor their names without the ending, in the tracked files, any commit or any commit message; `git ls-files local` is empty.

Result: every point holds; merged into `main` with `git merge --no-ff`.

### Lab Worker deleted

- `npx wrangler delete -c worker/wrangler.lab.jsonc`: "Successfully deleted website-check-lab". Check: its workers.dev address answers HTTP 404 with error 1042, the API answers "This Worker does not exist on your account" (code 10007). `LAB_TOKEN` is removed from the local `worker/.dev.vars`.

## History cleanup before the first push (21.11.2026)

Branch `history-cleanup`. A short service session at Fedor's request, no new functions: the repository becomes public, so personal details about the owner had to leave every file and every commit before the first push. Session time: about 20 minutes (17:28 to about 17:50). No browser, no site visited.

- Backup first: `git bundle` with HEAD and all four branches in `local/backup/` (git-ignored). `git bundle verify`: complete history; a clone of the bundle has 47 commits and 4 merges, `git fsck --full` without errors. The map of old to new commit hashes lies next to it.
- Search: all 287 file versions of all commits and all 47 commit messages, in English, German and Russian. A keyword search, then 8 independent readers read all 10,392 unique text lines of the history, and a ninth checked the raw files for what they missed. Result: 6 wordings in 5 files, in 31 file versions; none in commit messages, file names or code.
- Rewrite: `git filter-repo` 2.47.0 (in a temporary Python environment outside the repository) with literal text replacements of these lines only. First on a clone of the bundle, then the same command on the repository: both gave the same commit hashes.

Checks:
- Search after the rewrite: 0 places in the 47 commits of all branches, 0 in the commit messages, 0 in the working copy.
- 47 commits and 4 merges before, 47 and 4 after. Every commit compared with its old version: author, committer, e-mail addresses, dates with time zone, message and parents are the same, and every file equals the old file with only the replacements applied: 0 differences.
- The last commit of `main` differs from the old one by 7 lines in 5 files, exactly the replaced lines.
- `npm test`: 282 of 282 tests. `npm run typecheck`: no errors.
- No branch, tag, stash or other reference leads to the old history: the 4 branches are on the new history; no tags, no stash, no replace refs; reflogs empty; `ORIG_HEAD` removed. Of the 47 old commits 0 are still in the repository, of the 31 old file versions with the details 0. The old history exists only in the bundle in `local/backup/`.

Normal commits after the rewrite: the brief says that the agent works in the Code mode of the Claude app, not in VS Code; `docs/decisions.md` records the rewrite; the hash of the A2 merge commit above is updated to the new history (no other commit hash is named in the repository).

Result: every check holds; merged into `main` with `git merge --no-ff`.

## Second history cleanup before the first push (22.11.2026)

Branch `history-cleanup-2`. A second short service session at Fedor's request, no new functions, A4 not started. Fedor's answers: the reason behind the report format leaves the brief and `CLAUDE.md` while the rule itself stays; the whole history is searched again for personal details about the owner; project rules stay (zero budget, Windows, the laptop's specs). Session time: about 30 minutes (13:50 to about 14:20). No browser, no site visited.

- Backup first: a second `git bundle` with HEAD and all five branches in `local/backup/`, next to the first one (git-ignored). `git bundle verify`: complete history; a clone of the bundle has 51 commits and 5 merges, `git fsck --full` without errors. Both bundles stay until Fedor has checked `main` on GitHub. The map of old to new commit hashes of this rewrite lies next to them.
- Search: all 290 file versions of all 51 commits and all 51 commit messages, in English, German and Russian. A keyword search, then 6 independent readers read all 10,687 unique text lines of the history (2,043 of prose and commit messages, 8,644 of code, data and HTML); the lock file and Google's domain list (1,435 generated lines) by keyword search only. Result: 4 wordings in 3 files (`CLAUDE.md`, `docs/brief.md`, `docs/decisions.md`), in 23 file versions; none in commit messages, file names or code. Places that are project rules and not personal details stay.
- Rewrite: `git filter-repo` 2.47.0 (in a temporary Python environment outside the repository) with literal text replacements of these lines only; every rule stays, only the personal part of the line changes. First on a clone of the new bundle, then the same command on the repository: both gave the same commit hashes.

Checks:
- Search after the rewrite: 0 places in the 51 commits of all branches, 0 in the commit messages, 0 in file names, 0 in the working copy.
- 51 commits and 5 merges before, 51 and 5 after. Every commit compared with its old version: author, committer, e-mail addresses, dates with time zone, message and parents are the same, and every file equals the old file with only the replacements applied: 0 differences (32 changed lines in 23 file versions).
- The last commit of `main` differs from the old one by 6 lines in 3 files, exactly the replaced lines.
- `npm test`: 282 of 282 tests. `npm run typecheck`: no errors. `git fsck --full`: no errors.
- No branch, tag, stash or other reference leads to the old history: the 5 branches are on the new history; no tags, no stash, no replace refs; reflogs empty. Of the 51 old commits 0 are still in the repository, of the 23 old file versions with the details 0. During the search the old `main` of the first bundle was fetched into the repository once for a comparison (a temporary ref, deleted at once); the rewrite's cleanup removed those objects too: of its 47 commits and 31 file versions with details 0 are in the repository, and the left-over `FETCH_HEAD` was removed. The old history exists only in the two bundles in `local/backup/`.

Normal commits after the rewrite: `docs/decisions.md` records the second rewrite; the hash of the A2 merge commit above is updated to the new history (no other commit hash is named in the repository).

Result: every check holds; merged into `main` with `git merge --no-ff`.

## A4: mandatory information and system detection (22.11.2026)

Branch `a4-impressum`. Session time: about 1 hour 30 minutes (14:24 to about 15:55). No Cloudflare, no deploy, nothing pushed. Local browser only: one run of the 30 sites (15:01 to 15:07), then only re-analysis of the saved captures.

Fedor's answers before the start (in `docs/decisions.md`): axe on the homepage only; the comparison with axe on an unchanged page is the right method; the design's "Soll nach Gesetz und Richtlinie" stays (checked again with the German texts in stage C, `docs/backlog.md`); the sentence about the native speaker stays; "postal address" stays.

### What was done

- Step 1: the two history backups and the hash maps are deleted from `local/backup/` (two bundles, four commit and ref maps, two lists of the old commits and messages; the folder is gone). `main` equals `origin/main` (cd6687b).
- Step 2: branch `a4-impressum` from `main`.
- Step 3, links: the page snapshot marks footer links and keeps legal links beyond the 1,500-link cap; `scanner/src/legal/links.ts` finds the Impressum, Datenschutz and Erklärung zur Barrierefreiheit links by German and English texts (exact text first, then footer, then document order; by address only as a whole path word for a link without text). No address is ever guessed: without a link the state is `no-link`, "nicht gefunden, bitte manuell prüfen".
- Step 4, second tab: the local adapter opens the Impressum in a second tab of the same browser context after the homepage (`captureImpressumTab`), waits for DOMContentLoaded and then only until the text is stable, reads text and links, closes the tab; no axe. Shared settings and the wait rule are in the core (`scanner/src/legal/impressum-capture.ts`) for the Cloudflare adapter in A5.
- Step 5, templates (`scanner/src/legal/fields.ts`): postal address, e-mail (plain, mailto, "[at]", "(at)", "{at}", "[ät]", " at ", "[dot]", "(dot)", " dot ", "[punkt]", Cloudflare protection), Handelsregister (HRA/HRB, number, court), USt-IdNr (DE plus 9 digits). Each field is found with its exact quote or "nicht gefunden, bitte manuell prüfen"; third-party blocks are skipped. Analyzer `analyzeLegal` with the states of the Impressum.
- Step 6, system detection: `scanner/src/platform/fingerprints.ts` and `analyzePlatform`; 80 signals (65 strong, 15 weak) of WordPress, WooCommerce, Shopify, Shopware 5 and 6, Wix and Jimdo, each documented with its source in `docs/cms-fingerprints.md` (research by three helpers, every source opened again by a skeptical reviewer: 95 of 96 claims confirmed, the one not confirmed is not used, three made weak on the reviewers' advice).
- Step 7, fixtures: 37 synthetic Impressum pages and 22 homepages with invented firms and `.example` domains (`scanner/fixtures/impressum/`, `scanner/fixtures/legal-links/`), written by one helper and confirmed by a second who extracted every field without seeing the expected values (0 differences); Chromium snapshots for `npm test`, compared again in the integration test.
- Step 8: local run of the 30 sites, manual check on two samples of ten (independent reviewers who saw only the saved data, never the scanner's result, and a judge for every difference), and an independent code review from three angles. Details and numbers: `docs/measurements/a4.md`.
- Fixes during the session, each with a test on invented text: four from the first local run (a court address and a course venue taken for the operator's address, two operator addresses missed), one from the second sample (an agency's service page "Digitale Barrierefreiheit" taken for an accessibility statement: a link that names only the topic is now "bitte manuell prüfen"), and 16 from the code review (among them mailto links of agencies, social handles as e-mails, chamber blocks, years as house numbers, article titles as Impressum links, one-page sites, exponential backtracking of the town pattern). After every fix the 30 saved captures were analysed again without visits.

### Numbers

- Local run, 30 sites: 30 of 30 captured. Impressum link 30 of 30 (footer 26), Datenschutz 30 of 30; Erklärung zur Barrierefreiheit found 1, plus 2 links that name only the topic (manual check). Second tab opened 30 times.
- Browser time the Impressum adds (local, tab open to close): median 1.2 s, mean 1.3 s, max 4.3 s; all 30 stopped on stable text. Estimate for the free plan with A3's homepage numbers: about 78 full checks per day instead of 54 (to be measured on Cloudflare in A5).
- Fields found (of 30 Impressum texts): address 29, e-mail 30, Handelsregister 13, USt-IdNr 25; 97 of 97 quotes are exact parts of the page text or link addresses.
- System on the 30 sites: WordPress 12 (WooCommerce 4), Shopify 4, Shopware 4, Wix 3, Jimdo 3, unbekannt 4: the mix noted when the sites were chosen.
- Fields the scanner did not find although they are on the page (for the Claude API question of stage D): 2 of 66 on the 20 checked Impressum pages (3 %), both Handelsregister entries (one without "HRA"/"HRB", one under a heading that names an authority); none was shown only as an image. On the first sample before the fixes: 4 of 33.

### Merge condition of A4

- `npm test` passes completely, with the synthetic Impressum pages: 403 of 403 unit tests (37 Impressum and 22 link fixture pages, the manifest and snapshot checks among them). Also `npm run test:integration` 43 of 43 (the second tab in Chromium, the fixture snapshots) and `npm run typecheck` without errors.
- On 10 sites every found field checked by hand, 0 wrong: yes. First sample (Site 02, 05, 08, 11, 14, 17, 20, 23, 26, 29, picked by rule before the run): 31 Impressum fields found, 0 wrong (30 the same as the reviewer, 1 the same address in the form of another line of the page, judged right); 20 links found, 0 wrong. The first pass before the fixes had 1 wrong field (a court address) on this sample. Second sample with the final scanner (Site 01 … 28): 33 fields found, 0 wrong; 20 links, 0 wrong.
- System right on 10 of 10: yes, 10 of 10 on the first sample, also 10 of 10 on the second.
- No addresses, site names or data of real Impressum pages in git: 0 hits for 171 search strings (the 32 domains and names of `local/sites.txt` and `local/sites-v1.txt`, the 97 found values of the 30 sites and the reviewers' values) in the 256 tracked files, in the added lines of every commit of the branch and in their messages (checked again right before the merge). `git ls-files local` is empty.

Result: every point holds; merged into `main` with `git merge --no-ff`.

## A5 part 1: SSRF protection (22.11.2026)

Branch `a5-api` from `main`, not merged (part 3 merges). Session time: about 1 hour (23:06 to about 00:05). No Cloudflare, no deploy, nothing pushed, no browser minutes. No test site was visited: the only contact with the 30 sites was name resolution.

Fedor's answers to the A4 questions are in `docs/decisions.md` (owner decisions of 22.11.2026), the two texts as drafts in `docs/content-drafts.md` (`legal-impressum-no-link`, `legal-accessibility-statement-uncertain`).

### What was built

- `scanner/src/security/address.ts`: IPv4 in every notation the URL standard accepts (decimal, octal, hex, shortened, trailing dot), IPv6 with `::` and an IPv4 tail, the non-public ranges of the IANA registries for IPv4 and IPv6, every IPv6 form with an IPv4 inside refused, special-use and single-label host names.
- `scanner/src/security/ssrf.ts`: the URL guard (http or https, ports 80 and 443, no user name or password, the host or every A and AAAA record public, names resolved once per scan) and `safeFetch` (each redirect checked before it is requested, at most 5, one 10 s limit for DNS, hops and body, at most 2 MB, only `Accept`, `Accept-Language` and the user agent sent). Name resolution: the operating system's resolver on the laptop (`scanner/src/local/node-resolver.ts`), DNS over HTTPS in the Worker (`scanner/src/security/doh.ts`).
- `scanner/src/security/navigation-guard.ts`, shared by both adapters: the browser protocol pauses every document request of the main frame before it is sent and lets it go only after the guard accepted it, so the first address, every HTTP redirect, meta refresh and script navigations are checked inside the browser; the sixth redirect or navigation is refused.
- Local Playwright adapter: the address is checked before a browser context opens; the guard sits on the homepage and on the Impressum tab; the http redirect check uses the same guard. Cloudflare adapter: the same for strategy (a) and strategy (b). A refused capture has the new failure reason `not-allowed` and no findings.
- After an independent review (no bypass found in the address rules, `safeFetch` or the dev exemption; two navigation paths outside the page's own requests): windows opened by the page itself are refused (locally by Chrome's popup blocker, which Playwright switches off by default; in the Cloudflare adapter by a guard on the browser target that fails the top-level document of any page the scanner did not create); speculation-rules prerendering is switched off; the address of the document the data was read from must pass the guard too; the time limit of the http redirect check covers name resolution. Before the fix a popup reached 127.0.0.1 in both adapters (tests failed with 1 hit); afterwards 0.
- Lab Worker: the old host regex is replaced by the guard. Its dev mode now exempts only exact fixture origins (`LAB_DEV_ORIGINS`), no longer every local address.
- Decisions with reasons in `docs/decisions.md` (A5 part 1), open points in `docs/backlog.md` (subresources and iframes are not checked, DNS rebinding, states for B2, the Impressum tab of the Cloudflare adapter in part 3).

### Numbers

- `npm test`: 516 of 516 (403 before). The SSRF suite `scanner/test/ssrf.test.ts` has 108 cases: URL rules 10, IPv4 notations 11, IPv4 ranges 22, IPv6 27 (12 of them IPv4 inside IPv6), host names 14, names that resolve to internal addresses 10, `safeFetch` 8 (redirect to 127.0.0.1, redirect to a name with a private address, sixth redirect, body over 2 MB by length and by stream, time limit without an answer, with a stalled body and with slow DNS), DNS over HTTPS 3, navigation guard 3 (prerendering off before interception, the read document checked). Plus 3 new cases of the http redirect check in `scanner/test/security.test.ts` (among them the time limit with a slow resolver).
- `npm run test:integration`: 59 of 59 in Chromium (Playwright), among them 15 SSRF cases: a normal page loads; control with every address exempt: the redirect does reach the internal page (1 hit); HTTP redirect to 127.0.0.1, decimal notation after an allowed hop, meta refresh, script navigation in hex notation: each refused, 0 hits on the internal page; sixth redirect refused; Impressum link to 127.0.0.1 refused while the homepage stays captured; six internal or non-http addresses refused before any browser context; a prerendered page that navigates to 127.0.0.1 once activated, three kinds of windows opened by script (`window.open`, with `noopener`, a script click on a `target=_blank` link) and a same-origin iframe that navigates the top document: 0 hits; control with Playwright's default launch flags: the popup does reach the internal page. Plus one case of the http redirect check against the real fixture server (redirect to localhost not followed, 0 hits).
- Cloudflare adapter on plain `wrangler dev` (local workerd and local Chrome, no account, no browser minutes): 19 of 19 in `worker/test/integration/ssrf-dev.test.ts`, run by `npm run test:integration` too. A normal page loads with both strategies; control: an image from 127.0.0.1 reaches the server (subresources are not checked); HTTP redirect, decimal redirect, meta refresh and script navigation to 127.0.0.1 refused by strategy (a), by strategy (b) the HTTP redirect, the meta refresh, the script navigation and the top navigation from an iframe; the same iframe case, the prerender case and five popup cases (three kinds in strategy a, two in strategy b) with 0 hits; the sixth redirect refused; four internal job addresses answered with HTTP 400; 0 hits on the internal page in every case. No workerd or Chrome process was left after the run.
- `npm run typecheck`: no errors.
- The guard on the 30 test sites, by name resolution only (no visit): 93 addresses (the requested addresses, and from the saved A4 captures the final addresses, the http redirect hops and the Impressum addresses), 93 allowed, 0 refused. Time of the guard per site with the operating system's resolver: median 109 ms, max 1.6 s (first lookup). In the 30 saved captures no main document came with a redirect.
- DNS over HTTPS against the real resolver with a neutral name: `example.com` gave two A and two AAAA records (259 ms); a public name that points to 127.0.0.1 was refused after resolving.
- `git ls-files local` is empty.

## A5 part 2: report schema, D1, API, cache, rate limit (23.11.2026)

Branch `a5-api`, not merged (part 3 merges). Session time: about 1 hour (00:07 to about 01:05). No Cloudflare account, no deploy, nothing pushed, no browser minutes, no site visited. Local D1 only (wrangler's local runtime). The only network use was DNS over HTTPS for `example.com` in one local `wrangler dev` check.

Fedor's answer before the start (in `docs/decisions.md`): in version 1 subresources and frames inside the page are not checked by the SSRF guard; the main document and each of its navigations are; looked at again after the measurement in part 3.

### What was built

- Step 1, report schema v1: `scanner/schema/report.v1.schema.json` (JSON Schema 2020-12), types in `scanner/src/report/types.ts`, the builder `buildReport` (capture in, report and D1 host rows out), a validator for exactly the keywords the file uses (`validate.ts`, checked against Ajv in the tests), `normalizeSiteAddress` and punycode for the display host. States `complete`, `quick` (with the notice "Die vollständige Prüfung ist morgen wieder möglich."), `blocked`, `not-allowed`, `failed`; the country and data center of the visit. `docs/report-schema.md` maps every element of `design/reference/bericht.html` to a field and lists what is missing. `npm run report:check` builds and validates reports from saved captures without visiting any site.
- Step 2, D1: `worker/migrations/0001_initial.sql` with `sites`, `scans` (creation date for the retention rule, the report as text), `findings`, `network_requests` (one row per host), `leads` (table only), `rate_salts`, `rate_events`; `worker/wrangler.jsonc` with the D1 binding (placeholder id, logs off); `worker/src/db/store.ts`. Rows written measured on the local D1, budget in `docs/d1.md`.
- Step 3, API (`worker/src/api/`): `POST /api/scans` (normalized address, 400 for every address the SSRF rules refuse, also after DNS; the scan of the same address from the last 24 hours; 5 new scans per hour per visitor; a queued scan with a random 128-bit id), `GET /api/scans/{id}`, `GET /api/scans/{id}/report` (the stored text, never parsed; 409 until done). Every answer: `X-Robots-Tag: noindex, nofollow, noarchive`, `Cache-Control: no-store`. The queue itself (`dispatch`) comes in part 3; until then a scan stays queued.
- Step 4, tests on the local D1 (`getPlatformProxy`, in memory, fake name resolver).

### Numbers

- `npm test`: 657 of 657 (516 before). New: report schema and builder 42, address and punycode 45, SSRF host names 6, API 42, D1 budget 2, Worker entry 1 (the old 501 test replaced), and the purity check of the 4 new core files. Among them: the cache (other spellings of the same address, 24 hours, reuse only of complete and blocked scans, a queued scan joined for 10 minutes, two visitors at the same moment get one scan); the rate limit (sixth scan 429 with `Retry-After` 3,300 s after five scans in five minutes, allowed again after the hour, IPv6 counted by /56, IPv4-mapped IPv6 as IPv4, a cached answer and a refused address take no slot, two starts at the same moment take one slot, no raw IP and no secret in any of the 7 tables, a new salt the next day and the old one deleted, no scan without the secret, the hourly cleanup without traffic); 17 refused addresses with HTTP 400 and 0 rows written (among them 127.0.0.1, `0x7f000001`, 169.254.169.254, `[::1]`, port 8080, `javascript:`, a name that resolves to 127.0.0.1, a name with one private address); a resolver failure 503; a 2 KB body limit also for a body without a length header (read stopped after fewer than 10 chunks); the report returned byte for byte (300,000 umlauts, odd spacing); 2,000 ids without a repeat; 17 reports (3 valid, 14 changed on purpose) on which our validator and Ajv agree.
- `npm run typecheck`: no errors. `npm run test:integration` after the review fixes (the URL guard changed): 59 of 59 in Chromium and 19 of 19 on plain `wrangler dev`, fixture pages only.
- Migration with the real tool: `wrangler d1 migrations apply website-check --local` ran 9 commands, all tables and indexes present.
- Local `wrangler dev` with the local D1 (workerd, no account): `http://127.0.0.1/` and `localhost:3000` 400; `example.com` 202 with a new id; `https://EXAMPLE.com/irgendwo` 200 with the same id (`cached: true`); status 200 (`queued`); report 409; afterwards 1 scan, 1 site, 1 rate event with a 32-character hash, 1 salt, 0 raw addresses; no workerd left. After the review fixes again with the secret from `worker/.dev.vars`: `http://10.0.0.1/` 400, `example.com` 202, `EXAMPLE.com/x` 200 cached, the cron handler (`--test-scheduled`) 200, no workerd left.
- Independent review (3 reviewers with different lenses, each finding checked by a skeptic who tried to refute it): 14 findings, 13 confirmed, 1 rejected as already recorded behaviour (the count starts again at 00:00 UTC). All 13 fixed, each with a test: service keys of very long domains broke the schema; services whose requests never got an answer were marked "data sent before consent" and "Graubereich"; the mandatory information counted as checked on a page whose text was not read; `beispiel.de..` got its own cache key and skipped the host-name rules; look-alike punycode domains were shown decoded; the rate-limit hash could be reversed from the database alone (event time matches the scan, salt in the same database), now keyed with a Worker secret; IPv6 by /64 gave a delegated /56 256 limits; salts and events outlived their time without traffic (hourly cron); `saveResult` threw on a retry; `createScan` could answer 500 in a race; the loser of a race paid a slot; the retention count included the cascade.
- Reports from the 30 saved captures of A4 (`npm run report:check`, no visit): 30 of 30 validate against the schema, all `complete`. Size median 13.7 KB, mean 14.6 KB, max 41 KB. Finding rows per scan median 7.5, max 23; host rows median 5, max 28; services median 3, max 17.
- D1 rows written per scan (measured, `docs/d1.md`): at the caps of the report (60 findings, 100 hosts) 334 rows including the later deletion by the retention rule; with 8 findings and 5 hosts 40 rows; the largest real capture 116. At 80 scans per day with 20 rows per scan kept free for part 3: 28,322 rows at the caps, 4,802 at the median, against Fedor's limit of 33,333 (a third of 100,000).
- `git ls-files local` is empty.

## A5 part 3: queue, Impressum tab, quick check, end to end on Cloudflare (23.11.2026)

Branch `a5-api`, **not merged**: one point of the merge condition failed (Worker CPU above 8 ms on 3 of 50 API requests). Session time: about 1 hour 40 minutes (18:14 to about 19:55). Browser time on Cloudflare: 36.1 s (0.6 browser minutes), one session; browser time of the day 36.1 s of 600. Lab Worker and lab D1 deployed with Fedor's permission and deleted at the end.

Fedor's answers before the start (in `docs/decisions.md`): an accessibility statement that was not found is "nicht gefunden, bitte manuell prüfen", never "fehlt"; the cost of element positions for "Feld B2" is measured, the field is not added; risk rule accepted with `usually-consent` services at medium risk (a test pins it); lab Worker and a separate lab D1 allowed for the end-to-end check, both deleted at the end, the real database is Fedor's.

### What was built

- Step 1, queue (`worker/src/queue/`): one Durable Object `ScanQueueObject` in the EU jurisdiction keeps the jobs and the day's counters; the Worker creates the scan in D1, hands it over and asks for the place in the queue while it waits (`queuePosition` in the status answer). Scans run in the object's alarm: at most 3 started per alarm run, up to 3 at the same time as tabs of one browser, one new browser at most every 20 s, the browser closed as soon as nothing needs it. Day caps per UTC day: 150 scans (then HTTP 503 `daily-limit` until 00:00 UTC), 80 full checks, and a full check only while the day's browser time plus 45 s stays within 540 s, with Cloudflare's own count checked before every launch; otherwise the quick check. Stuck jobs are retried once; the hourly cron ends scans stuck in D1 for 30 minutes. Reasons in `docs/decisions.md`.
- Step 2, Impressum tab of the Cloudflare adapter (`worker/src/capture/impressum.ts`): the same context, visitor settings, navigation guard, check of the read document, wait and snapshot as the local adapter; the homepage tab is closed first.
- Step 3, country of the visit: one trace tab per browser session (`Capture.visit`, report `visit.country` and `visit.colo`): 0.22 s of browser time per session on Cloudflare, once for all scans of the session.
- Step 4, quick check (`scanner/src/quick/`): homepage and Impressum fetched with `safeFetch` under the SSRF rules, read by a static HTML snapshot that follows the in-page snapshot; report `quick` with "Die vollständige Prüfung ist morgen wieder möglich."; third-party services and accessibility not checked. The HTML reader was written by a helper and then attacked by a second helper against the real Chromium on synthetic pages (no network): 12 defects found and fixed (9 differences, 3 CPU traps of up to 183 s on hostile 2 MB pages, now at most 0.3 s), 300 tests; on the 59 fixture pages of A4 the links match the browser on 57, the Impressum fields on 58 (the rest is script- or CSS-made and listed).
- The end-to-end lab Worker `worker/src/lab/e2e.ts` (real API and queue behind a token, an invented fixture page for windows, prerender and the Impressum) and the driver `npm run lab:e2e`.
- An independent review before the Cloudflare run (three lenses, every finding checked by a skeptic): 11 findings, 11 confirmed. Fixed before the run: a scan that started while the browser was opening ran with its own popup guard and the two guards closed each other's tabs; day counters lost updates with parallel scans (a test showed `full: 1` instead of 3); after the day cap every start still wrote D1 rows and got its slot back (now the isolate answers 503 without writes and the slot is kept); the dev switch on a real host (the Worker now refuses with 503); public hit routes of the lab counted forever (now only since the run); `alert()` froze a page until the hard limit (dialogs dismissed, as Playwright does); the "Feld B2" measurement could run into the hard limit; request records changed after the capture. Not fixed: the 50 subrequests per alarm run can be exceeded by a crafted site (backlog).

### Numbers (details in `docs/measurements/a5.md`)

- `npm test`: 1,000 of 1,000 (657 before part 3), among them the SSRF suite (108 cases), cache, rate limit, the queue (18), the scan job and API (12), the quick check (7) and the HTML reader (300). `npm run typecheck`: no errors. `npm run test:integration` after the last fix: 59 of 59 in Chromium (Playwright) and 21 of 21 on plain `wrangler dev` (two new Impressum cases: the text is read; a link to 127.0.0.1 is refused, 0 hits).
- End to end on Cloudflare: 6 of 6 reports valid (our validator and Ajv): Site 10, Site 14, Site 26 `complete` with the Impressum, the fixture page `complete`, two quick checks `quick`. Place in the queue 1, 1, 2, 3. Browser in Sweden (`SE`, ARN).
- Popup guard and prerender on the real Browser Run: 0 of 3 windows reached the server, the guard refused 3; the prerender page was fetched ahead once but never rendered (0 requests from it); controls prefetch, image and iframe 1 each.
- "Feld B2": 6 to 21 ms per page (mean 12.7 ms), about 0.1 % of a full check.
- Browser seconds per full check with the Impressum: 6.80, 6.00, 18.08 s (mean 10.29 s, median 6.80 s; one of the three ran to the 15 s limit); the Impressum adds 1.23 to 2.03 s; about 1 s per browser session for launch and trace. Free plan: about 52 full checks per day within the queue's 540 s at the mean (58 on the full 600 s), 79 at the median, 29 in the worst case.
- Worker CPU: 50 API events, median 1 ms, 3 above 8 ms (14 and 11 ms on starts of new scans, 9 ms on a start answered from the cache); all 62 Worker events `ok`. Durable Object: 27 of 27 events `ok`, at most 125 ms.

### Merge condition of A5

- `npm test` passes completely with SSRF, cache, rate limit and quick check tests: yes, 1,000 of 1,000.
- Three reports of the end-to-end check pass the schema: yes, 3 of 3.
- Worker CPU at most 8 ms on every request and the Durable Object never cut off: **no** for the CPU (3 of 50 API events: 14, 11, 9 ms); yes for the object (27 of 27 `ok`).
- At most 3 browser minutes in the session: yes, 36.1 s.
- No token, secrets, addresses or names of sites in git: yes (0 hits for 2 secrets and 64 site strings in 304 tracked files and the whole history; `git ls-files local` empty).

Result: not merged into `main`; everything is committed on `a5-api`.

### Lab deleted

Lab Worker deleted (workers.dev 404 with error 1042, API code 10007), lab D1 deleted (0 databases on the account), `LAB_TOKEN` removed from `worker/.dev.vars`.

## A5 part 4: the API Worker apart from the scan Worker, CPU per API request (23.11.2026)

Branch `a5-api`, **not merged**: the Worker CPU of the API is above 8 ms on 8 of 56 measured requests, all starts of new scans, 4 of them in warm instances. Session time: about 35 minutes (19:57 to about 20:32). Browser time on Cloudflare: 8.0 s (one session, Site 14), within the limit of 30 s; browser time of the day 44.1 s of 600. Lab Workers and lab D1 deployed with Fedor's permission and deleted at the end.

Fedor's answers before the start (in `docs/decisions.md`): the API Worker carries no Puppeteer, no axe-core and no rules data, the checks run in a separate Worker with the Durable Object; "Feld B2" stays and is built in the polishing session after the review; the quick check gets the windows-1252 fallback in the same session (both in `docs/backlog.md`).

### What was done

- Step 1, the split (commit 8784132): `scanner/src/api.ts` is a narrow entry `@website-check/scanner/api` (address rules, SSRF guard, DNS over HTTPS, normalized address) that the API imports instead of the whole scan core. The API Worker (`worker/wrangler.jsonc`, entry `worker/src/index.ts`) has the API, D1 and the cron, no browser binding, no axe text module, no `nodejs_compat`; the scan Worker (`worker/wrangler.scanner.jsonc`, entry `worker/src/scan-worker.ts`) has only the queue object with the browser, without a public address; the API reaches the object through a Durable Object binding with `script_name`. Bundle: 30.6 KiB instead of 2,011 KiB (dry run). The lab follows the same split (lab API Worker without Puppeteer, lab scan Worker with the production entry), the Browser Run limits are read by the queue object, the lab gate names the isolate and the request number in every answer, and `npm run lab:e2e:dev` starts both lab Workers in one local wrangler process. New test `worker/test/api-bundle.test.ts` (7 cases): the import graph of the API Worker and of the lab API Worker reaches no Puppeteer, axe-core, rules data, analyzers, public suffix list or Node built-in (with the old import it fails, checked), a control that the scan Worker does reach them, and the wrangler configs of both pairs agree. Checked locally before any deploy: on plain `wrangler dev` with both lab Workers the quick and the full check of the fixture page gave valid reports, the Impressum opened, the popup guard refused 3 windows.
- Step 2, the CPU measurement on Cloudflare (driver `npm run lab:cpu`, commit 9e985d4): four deploys of the lab API Worker, each followed by a round of 15 or 16 API requests that starts on a fresh instance; new scans were quick checks of example.com. Then a diagnosis round (`/lab/cost`, commit f83099c) with each operation of a start alone.
- Step 3, one end-to-end check with the browser: Site 14 through both lab Workers.
- Step 5, the lab deleted and checked (below).

### Numbers (details in `docs/measurements/a5.md`, part 4)

- API requests in the four rounds: 61, 56 matched with their tail event, all `ok`. Starts of new scans (16): 2 to 19 ms, median 9 ms, 8 above 8 ms. Every other API request (40): at most 5 ms. First requests of the 7 fresh instances: 15, 11, 7, 18, 12, 5 and 6 ms. Above 8 ms in warm instances: 19, 11, 10 and 10 ms (requests 2, 4, 5 and 8 of their instance).
- Diagnosis: an empty first request of a fresh instance 0 ms; six D1 reads in a row 2 to 4 ms; the DNS check of example.com 1 to 2 ms; a request to the queue object 0 ms; the visitor hash 0 ms. So the split removed the bundle (66 times smaller, startup 8 to 15 ms instead of 92 ms) but not the cost: a start makes about nine round trips (six to D1, two DNS-over-HTTPS queries, one to the queue object), and the measured CPU of the same code varies from 2 to 19 ms.
- End-to-end: Site 14 `complete`, homepage and Impressum checked, country `SE`; valid with our validator and with Ajv. Browser session 8.01 s by Cloudflare's history (`NormalClosure`). The start of this check cost 16 ms of Worker CPU.
- Queue object: 43 events, 42 `ok`, 1 `canceled` (0 ms CPU, no path; noted in the backlog), at most 414 ms CPU.
- `npm test`: 1,008 of 1,008 (1,000 before; 7 bundle and config cases, 1 purity case for the new entry). `npm run typecheck`: no errors. `npm run test:integration`: 59 of 59 in Chromium and 21 of 21 on plain `wrangler dev` (fixture pages only).

### Merge condition of A5 (session message of part 4)

- Worker CPU of the API at most 8 ms on every request, including the first requests of a fresh instance: **no**, 8 of 56 measured requests above 8 ms (10 to 19 ms), and not only first requests: 4 of them came in warm instances (19, 11, 10, 10 ms). With the end-to-end check 9 of 63. By the session message this is worse than "only the first requests of a fresh instance and at most 15 ms", so no merge.
- The end-to-end check gave a report that passes the schema: yes.
- `npm test` passes completely: yes, 1,008 of 1,008.
- No token, secrets, addresses or names of sites in git: yes. 67 search strings (the rate-limit secret, the lab D1 id, the account's workers.dev subdomain, the 60 hosts and names of `local/sites.txt` and `local/sites-v1.txt`) in the 313 tracked files, in the added lines of the commits of this session, in the whole history of all branches and in all commit messages: 0 hits, except the workers.dev subdomain in `docs/brief.md`, where Fedor named the future address of the site himself. The lab token of this session was deleted from `worker/.dev.vars` before the check, so it was searched as any 64-character hex string in the added lines of this session's commits: 0. `git ls-files local` is empty.

Result: not merged into `main`; everything is committed on `a5-api`.

### Lab deleted

Both lab Workers deleted (workers.dev 404 with error 1042; the API answers "does not exist on your account", code 10007, for both), the lab D1 deleted (`wrangler d1 list`: 0 databases on the account), `LAB_TOKEN` removed from `worker/.dev.vars`, the generated lab configs with the database id deleted. No workerd process left.

## A5 part 5: the start of a scan in the queue object, measurement, merge (23.11.2026)

Branch `a5-api`, **merged into `main`**. Session time: about 25 minutes (20:34 to about 21:00). Browser time on Cloudflare: 8.1 s (one session, Site 14), within the limit of 30 s; browser time of the day about 52 s of 600. Lab Workers and a lab D1 deployed with Fedor's permission and deleted at the end. No new functions.

Fedor's answer before the start (in `docs/decisions.md`): variant (a), the API Worker parses the request, normalizes the address and hands the whole start to the Durable Object (cache, DNS check, rate limit, D1 writes); `RATE_LIMIT_SECRET` belongs to the Worker with the Durable Object.

### What was done

- Step 1, the move (commit 2c38e8e): `worker/src/api/start.ts` holds the start as the queue object runs it (`POST /start`): the cache lookup, the day cap, the SSRF guard with DNS over HTTPS, the salt, the visitor hash with the secret, the rate-limit slot, the new scan in D1 and the hand-over to the object's own queue, in the order of A5 part 2 and 3. The API Worker (`router.ts`, `app.ts`) checks the content type and the body, normalizes the address (the address rules without DNS: a refused address gets 400 in the Worker), takes the visitor key and passes `{url, visitor}` on; the object's answer goes back unparsed with the API's headers; a failure of the object, or a status other than 200, 202, 400, 429 or 503, is 503 `queue-unavailable`. The object accepts only a normalized address, keeps one day gate for all starts, and replaces `/enqueue`. `RATE_LIMIT_SECRET` moved from the API Worker's environment to the scan Worker's. Status and report stay in the API Worker. Shared answers in `worker/src/api/answers.ts`. Tests: the API tests now run the router with the start behind it as the object runs it (`worker/test/api-local.ts`), and new cases check that a start in the API Worker touches no D1 (a binding that fails on any use), sends only the normalized address and the visitor key, refuses internal addresses before anything leaves the Worker, passes the object's answer and `Retry-After` on unchanged, answers 503 when the object fails, and that the object takes only the shape the Worker sends.
- Checked locally before any deploy (plain `wrangler dev` with both lab Workers, fixture page only): quick and full check of the fixture through the object, both reports valid, 3 windows refused; a second start of the finished full check answered from the cache; `http://127.0.0.1/` refused in the Worker; only 32-character hashes in the rate-limit table. No workerd left.
- The CPU driver (commit 64d1e08): rounds go to `local/a5/part5/`, and `--cache-site` starts the address of a site whose full check finished before (the cache path: answered from D1, the site not visited).
- Step 2, the measurement on Cloudflare: five rounds, each right after a deploy of the lab API Worker; new scans were quick checks of example.com.
- Step 3, one end-to-end check with the browser: Site 14 through both lab Workers.
- Step 5, the lab deleted and checked (below).

### Numbers (details in `docs/measurements/a5.md`, part 5)

- API requests in the five rounds: 69, all 69 matched with their tail event, all `ok`. CPU median 1 ms, max 5 ms, 0 above 8 ms (part 4: up to 19 ms, 8 of 56 above 8 ms).
- Starts of new scans: 20 (all HTTP 202): 0 to 5 ms, the two 5 ms as first requests of fresh instances. The cache path (Site 14's finished full check, `cached: true`): 4 ms as the first request of a fresh instance, 1 ms warm. First requests of the 10 fresh instances: 5, 4, 5, 1, 2, 2, 1, 4, 4, 2 ms. Status reads (22) at most 4 ms, reports (15) at most 1 ms, refused address at most 3 ms, unknown id at most 1 ms.
- End-to-end: Site 14 `complete`, homepage and Impressum checked, country `SE`; valid with our validator and with Ajv. Browser session 8.12 s by Cloudflare's history (`NormalClosure`). Its 8 API requests cost 0 ms each.
- Queue object: 48 events, 48 `ok`, 0 exceptions; `/start` median 3 ms, max 12 ms; alarm runs at most 30 ms; at most 187 ms (a `/position` request during the browser scan).
- `npm test`: 1,013 of 1,013 (1,008 before; the three tests of the old `/enqueue` client replaced by eight tests of the hand-over). `npm run typecheck`: no errors.

### Merge condition of A5 (session message of part 5)

- Worker CPU of the API at most 8 ms on every request, including starts, the cache path and the first requests of a fresh instance: yes, at most 5 ms over the 69 requests of the rounds, 0 ms over the 8 API requests of the end-to-end check.
- The Durable Object never cut off for CPU: yes, 48 of 48 events `ok`.
- The end-to-end check gave a report that passes the schema: yes (Site 14, both validators).
- `npm test` passes completely: yes, 1,013 of 1,013.
- No token, secrets, addresses or names of sites in git: yes. The rate-limit secret, the account's workers.dev subdomain and the hosts and names of `local/sites.txt` and `local/sites-v1.txt` in the tracked files, in the added lines of this session's commits, in the whole history of all branches and in all commit messages: 0 hits, except the workers.dev subdomain in `docs/brief.md`, where Fedor named the future address of the site himself. The lab token and the lab D1 id were deleted before the check, so the added lines of this session's commits were searched for any 64-character hex string and any UUID other than the placeholder: 0. `git ls-files local` is empty.

Result: merged into `main` with `git merge --no-ff`.

### Lab deleted

Both lab Workers deleted (workers.dev 404 with error 1042; the API answers "does not exist on your account", code 10007, for both), the lab D1 deleted (`wrangler d1 list`: 0 databases on the account), the lab token removed from `worker/.dev.vars`, the generated lab configs with the database id deleted. No workerd process left.

## fix-a1: the first polishing session after the review of stage A (23.11.2026)

Branch `fix-a1`, **merged into `main`**. Session time: about 30 minutes (22:53 to about 23:25). No Cloudflare, no browser minutes, no site visited: everything ran on the laptop (unit tests, the local Chromium against pages on 127.0.0.1, the saved captures).

Fedor's answer before the start: the polishing by the review comes first, then B1; the review of the German drafts is not awaited (stage C).

### What was done (review findings 1, 17, 2 and 3)

- Findings 1 and 17, requests without a known document. Every request of a capture now says whether its document is known (`frameKnown`). The Cloudflare adapter decides it at the end of the capture: an iframe whose address Puppeteer learned after its first requests gets that address, a CORS preflight the document of the request it belongs to, a request of a web worker the document that loaded the worker script; the rest stays unknown. A service is a finding only when a request with a known document reached it; seen only in requests without one it is a hint "bitte manuell prüfen" (`third-party-frame-unknown`, Stückliste tag `manual`, no risk, no fix text). Platform detection ignores such requests. Captures of the Cloudflare adapter saved before the field are read the same way.
- Finding 2, a capture that was cut off. The hard limit of a page, a crashed or a closed tab after the main document answered is a failed capture in both adapters (`timeout` or `other`), and `recheckCapture` fails any capture that stopped with an error. A browser lost during a capture makes the adapter throw: the scan ends as an error without a report. Neither is reused from the 24-hour cache.
- Finding 3, a page that looks like bot protection outside the exact rule. A text that says the browser is being checked counts with a redirect sentence too (`blocked`). A page with at most 1 500 characters of text, 3 links and 15 requests and without a link to an Impressum or a Datenschutzerklärung is "almost empty": the report keeps the state `complete`, gets the notice `report-page-almost-empty`, no Prüfmaß is `pass` (each becomes `manual`), and the missing Impressum link carries no risk (`legal-impressum-no-link-empty-page`). No new report state (the D1 schema lists the states).
- Three German draft texts for the new ids in `docs/content-drafts.md`, the decisions in `docs/decisions.md`, the open points in `docs/backlog.md`, the new values in `docs/report-schema.md`.

### Tests

- Each finding has tests built from the review's reproductions. Run against the code before the fix (sources of `main`, the new tests): 22 unit tests and 7 of the 8 tests of the Cloudflare adapter failed (the eighth is the control); with the fix all pass.
- Unit tests: `scanner/test/frame-unknown.test.ts` (9, findings 1 and 17 in the analyzers and the report), `scanner/test/honest-states.test.ts` (18, findings 2 and 3), `worker/test/capture-frames.test.ts` (6, where a request belongs), one case in `worker/test/scan-job.test.ts` (a cut-off capture and a lost browser are not reused from the cache).
- The Cloudflare adapter itself on the local Chromium (`worker/test/integration/cdp-capture.test.ts`, 8 tests, pages on 127.0.0.1): a preflight and a web worker inside a third-party iframe, the same two of the page itself, two iframes that answer at almost the same time with 25 ms between the Worker and the browser (8 captures), a tab that crashes, a page cut by the hard limit, a lost browser. The local adapter got the hard-limit case and a check that every request names its document (2 tests).

### Saved captures analysed again (no site visited)

- All 257 saved captures under `local/` (189 of real sites from A1 to A4, both adapters, 186 of them analysed as loaded pages and 3 blocked; 68 of our own fixture pages), reports built with the code before and after the fix.
- Reports that changed: 24, all of our own fixture pages (the 12 accessibility fixtures, each captured by both adapters). They are pages of 42 to 346 characters with at most one link and no Impressum link, so they are "almost empty" (finding 3): the notice appears, 2 to 3 Prüfmaße go from `pass` to `manual`, and the missing Impressum link loses its high risk (in 12 of them it leaves "Drei Dinge").
- Reports of real sites that changed: 0 of 189. No state changed in any of the 257 (no ordinary page became blocked or failed), and no list of services changed.
- Requests without a known document in the 54 analysed captures of the Cloudflare adapter: 197 of 6,706 (36 preflights), in 16 captures; 7 services were seen only in such requests, none of them with a risk class that gives a finding, so no report changed.
- `npm run scan:local -- --reanalyze`: the 32 third-party results are the same as before except for the new fields. `npm run report:check`: 30 of 30 reports valid, the summary identical.

### Merge condition of fix-a1 (session message)

- Findings 1, 2, 3 and 17 fixed, each with a test: yes (above).
- `npm test` and the integration tests pass completely: yes. `npm test` 1,048 of 1,048 (1,013 before); `npm run test:integration` 61 of 61 in Chromium (59 before) and 29 of 29 in the worker project (21 on plain `wrangler dev` as before, 8 new on the local Chromium). `npm run typecheck`: no errors.
- Every change in the reports of the saved captures is explained: yes, 24 changes, all by finding 3 on our own fixtures.
- No secrets, addresses or names of sites, no review file and no reproduction scripts in git: yes. 171 search strings (hosts and names of `local/sites.txt` and `local/sites-v1.txt`, the Impressum values found on the 30 sites) and the value in `worker/.dev.vars`: 0 hits in the 323 tracked files, in the added lines of this session's commits and in their messages. No tracked path and no tracked line names the review folder. `git ls-files local` is empty.

Result: merged into `main` with `git merge --no-ff`.

### Not done, on purpose

- The other findings of the review (the session message names four).
- A web worker started from a `blob:` or `data:` address stays without a document, also when the page itself started it (`docs/backlog.md`).
- What an almost empty page did show still counts (a third-party finding, the security headers): question for Fedor in the report of this session.
- The new report states are not designed: the tag `manual` and the notice `report-page-almost-empty` (`docs/report-schema.md`, items 15 and 16).

## fix-a2: the second polishing session after the review of stage A (24.11.2026)

Branch `fix-a2`, **merged into `main`**. Session time: about 1 hour (23:35 on 23.11.2026 to about 00:37 on 24.11.2026). No Cloudflare, no browser minutes, no site visited: everything ran on the laptop (unit tests, the local Chromium against pages on 127.0.0.1, the saved captures).

Fedor's answer before the start (in `docs/decisions.md`): an almost empty page shows no findings, only the notice and manual checks.

### What was done (the answer, and review findings 18 to 24)

- The answer: in the report of an almost empty page every item of the kind finding or hint is left out, nothing has a risk, "Drei Dinge" is empty, every checked Prüfmaß is `manual` without a value, no service of the Stückliste is "Einwilligung fehlt", and the block with the measured state of HTTPS and the headers is empty.
- Finding 18, "Seite ohne HTTPS": an address entered with http:// gets one plain request to its https:// address in every adapter (`Capture.httpsProbe`). A page that stayed on http:// is "ohne HTTPS" only when that connection was refused or https:// sent the visitor back to http://; when https:// answers, only the missing redirect is a finding; without a clear answer (an error page, a reset, a certificate error, another final host) it is "bitte manuell prüfen".
- Finding 19, "Keine Weiterleitung von http:// auf https://": the check reads the `Refresh` header and the first 64 KB of a page answered with 2xx. A meta refresh to https:// is a note without a risk; a script that may switch to https, a refresh to another http:// address and a page not read to the end of its head are manual checks; the text of the finding now states what the server answered.
- Finding 20, "Bilder mit Beschreibung": the script in the page splits the images that pass the axe rule into described ones and ones marked as decoration (`alt=""`, a presentation role). The Prüfmaß counts only described images; images marked as decoration are a manual check with their count. The counts of the axe rule itself stay those of a standard run.
- Finding 21, the quick check: a missing Impressum link is a manual check without a risk ("im HTML-Quelltext nicht gefunden"); a source without text and links leaves the mandatory information and the system "nicht geprüft".
- Finding 22: the table `scans` stores the mode of a scan (migration `0002_scan_mode.sql`), and the 24-hour cache reuses only full checks; a blocked quick check says in its notice that it was the quick check.
- Finding 23: axe (locally also the saved HTML and screenshot) is read only from a document the guard allows and that is still in the tab afterwards; otherwise the result is dropped, and a refused document fails the capture.
- Finding 24: the local adapter refuses windows the page opens itself with the same guard as the Cloudflare adapter.
- Five new German draft texts and three changed ones in `docs/content-drafts.md` (`security-https-available`, `security-http-redirect-in-page`, `a11y-image-alt-decorative`, `legal-impressum-no-link-quick`; `report-page-almost-empty`, `security-http-no-redirect` and the notes of three more), the decisions in `docs/decisions.md`, the open points in `docs/backlog.md`, the new values in `docs/report-schema.md`.
- An independent review of the branch before the merge (one helper with its own scripts, the reviewer's findings checked by running them) found no gap in the SSRF protection, no request past the time limit and no SQL mistake, and nine points about the honesty of the new results: seven were fixed before the merge, two belong to other findings of the review and are in `docs/backlog.md`.

### Tests

- Each finding and the answer have tests built from the review's reproductions. Run against the code before the fix (sources of `main`, the new tests as they were before the independent review): 39 unit tests and 13 tests in Chromium failed; with the fix all pass. One extra case of finding 24 (the shortest capture) passed before the fix too and stays as a guard.
- Unit tests: `scanner/test/honest-states.test.ts` (the answer, 5 new), `https-honest.test.ts` (17, findings 18 and 19), `images-described.test.ts` (6) with cases in `axe-script.test.ts` and `accessibility.test.ts` (finding 20), `quick-script-links.test.ts` (5, finding 21), `read-checked-document.test.ts` (6, finding 23), `worker/test/quick-honest.test.ts` (8, finding 22 with the real queue on the local D1, and finding 18 through the API).
- In the local Chromium (pages on 127.0.0.1): 8 image pages through the local adapter and the pinned axe-core, compared with a standard run (finding 20); 4 pages that open a window once the page has user activation, a control without the guard, and a page that moves to a prefetched internal page after the snapshot (findings 24 and 23, local adapter); the same last page through the Cloudflare adapter (finding 23).

### Saved captures analysed again (no site visited)

- All 257 saved captures under `local/` (189 of real sites, 68 of our own fixture pages), reports built with the code before and after the session; every single change was assigned to its cause by a script: 0 unexplained, and no state changed.
- Reports of real sites that changed: 70 of 189, all in one row only, the Prüfmaß "Bilder mit Beschreibung" (finding 20): the saved captures do not say how the passing images split, so 63 rows go from "erfüllt" with a count to "bitte manuell prüfen" without one, and 7 rows stay "nicht erfüllt" and lose the count. The other 119 have no accessibility data (111), no image that passes the rule (5), or are blocked (3). No finding, no risk and no "Drei Dinge" of a real site changed.
- Reports of our own fixture pages that changed: 68 of 68. All 68 were captured on http://127.0.0.1 and never asked https://, so "Seite ohne HTTPS" with a high risk becomes "bitte manuell prüfen" (finding 18), with "Drei Dinge" and the counts following. The 24 almost empty ones (the accessibility fixtures) lose their findings and hints and show every Prüfmaß as `manual` without a value (the answer). In 10 the images row changes as on the real sites (finding 20).
- Findings 19, 21 and 22 change no saved report: no saved capture has a redirect inside the page (the 75 saved checks of the redirect all found a redirect of the server), and no capture of the quick check is saved.
- `npm run scan:local -- --reanalyze`: the result files are identical to those before. `npm run report:check`: 30 of 30 reports valid.

### Merge condition of fix-a2 (session message)

- Findings 18 to 24 fixed, each with a test: yes (above).
- `npm test` and the integration tests pass completely: yes. `npm test` 1,096 of 1,096 (1,048 before); `npm run test:integration` 75 of 75 in Chromium (61 before) and 31 of 31 in the worker project (29 before). `npm run typecheck`: no errors.
- Every change in the reports of the saved captures is explained: yes, 138 changed reports, 0 unexplained changes.
- No secrets, addresses or names of sites, no review file and no reproduction scripts in git: yes. The hosts and names of `local/sites.txt` and `local/sites-v1.txt`, the Impressum values found on the 30 sites and the value in `worker/.dev.vars`: 0 hits in the 329 tracked files, in the added lines of this session's commits and in their messages. No tracked path and no tracked line names the review folder. `git ls-files local` is empty.

Result: merged into `main` with `git merge --no-ff`.

### Not done, on purpose

- The other findings of the review (the session message names seven).
- A redirect to https:// made by an external script, and the request of a speculation-rules prefetch itself (`docs/backlog.md`).
- The new report values are not designed (`docs/backlog.md`, `docs/report-schema.md`).

## fix-a3: the third polishing session after the review of stage A (24.11.2026)

Branch `fix-a3`, **merged into `main`**. Session time: about 45 minutes (01:00 to about 01:45). No Cloudflare, no deploy, nothing pushed. The local browser visited the 30 test sites once (homepage and Impressum, 01:00:52 to 01:06:02); everything else ran on saved captures and on pages on 127.0.0.1. Two helpers (Sonnet) did the blind manual check.

Fedor's answers before the start (in `docs/decisions.md`): "Bilder mit Beschreibung" follows axe; a new local run comes first; the list of services of an almost empty page stays with the tag "manuell prüfen".

### What was done

- Local run of the 30 sites into `local/fix-a3/` (git-ignored): 30 of 30 captured, the Impressum tab opened 30 times and read 30 times. Fields found: address 29, e-mail 30, Handelsregister 13, USt-IdNr 25 of 30, the same as in A4. For the first time the captures say how the images split: 407 of 437 images that the rule checked have a description; 111 images on 17 sites are marked as decoration.
- Answer 1: the row "Bilder mit Beschreibung" is "erfüllt" when no image lacks a description; images marked as decoration stay a separate manual check with their count and stay out of the numbers. On the new run: "erfüllt" on 27 sites, "nicht erfüllt" on 3.
- Finding 5, Impressum fields: every postcode with a town counts as an address, also when the template does not read its street. The first address without a label of someone else is the operator's; a later address in another place is not reported, and register entry, VAT id and e-mail count only up to the next address of another firm (an e-mail after it only on the site's own domain). The address of a court, a chamber, an authority or an insurer does not end the operator's part. More labels of third parties.
- Finding 6: the page behind the Impressum link is searched only with a sign of an Impressum (title, a sentence of a legal notice, the word outside the link texts); an error page with HTTP 200 and the homepage under another address are the state `failed`, "bitte manuell prüfen".
- Finding 7: a label that only contains "Impressum" counts only as a combined label of legal pages; a link of the site itself comes before a link to another site.
- Finding 14: a Datenschutz link to another site or to an anchor of the homepage is the manual check `legal-datenschutz-uncertain` (draft text), never "vorhanden"; compound words only from a list.
- Finding 15: an accessibility link is certain only as the name of the statement; "Informationen zur Barrierefreiheit", texts with more words and links to other sites are "Link gefunden, bitte prüfen".
- Finding 16: soft hyphens and zero-width characters are removed from the Impressum text and the link texts before anything is matched.
- Small findings 71 to 74, each within 15 minutes with tests: mailto links with a common text, quantities and sentences after five digits, register numbers and their quote, the label of a VAT id.
- Small finding 75 (system detection) is not done: the proposed rule turned 55 saved captures of correctly detected sites into "unbekannt". It was taken back and is in `docs/backlog.md` with what it needs.
- Decisions in `docs/decisions.md`, open points in `docs/backlog.md`, the new report value in `docs/report-schema.md`, the draft text in `docs/content-drafts.md`.

### Tests

- Each finding and the answer have tests built from the review's reproductions: `scanner/test/impressum-owner.test.ts` (68: findings 5, 16 and 71 to 74), `legal-links-honest.test.ts` (20: findings 7, 14, 15, 16), `impressum-page.test.ts` (8: finding 6), four new or changed cases in `images-described.test.ts` (answer 1), and in Chromium one case in `test/integration/legal.test.ts` (finding 6 through the local adapter) and the image pages of `a11y-security.test.ts`.
- Run against the code before the fix (sources of `main`, the new tests): 65 of these 104 unit tests failed, at least one for every finding (finding 5: 18, 6: 3, 7: 7, 14: 4, 15: 4, 16: 6, 71: 1, 72: 7, 73: 3, 74: 9, answer 1: 3) and 4 tests in Chromium (finding 6: 1, answer 1: 3); the other 39 are controls that must pass before and after. With the fix all pass.
- Three older tests were changed on purpose: two Impressum tabs of `legal.test.ts` got the title "Impressum" (a page without any sign of an Impressum is no longer searched), and the fixture with a mailto link under the text "E-Mail schreiben" is read with the firm's own domain (finding 71).

### Saved captures analysed again (no site visited)

- All 287 saved captures under `local/` (219 of real sites, among them the 30 new ones; 68 of our own fixture pages), reports built with the code of `main` and with the code of the branch; a script assigned every single change to its cause: 0 unexplained, no state changed.
- Reports of real sites that changed: 29 of 219. Reports of fixture pages: 0 of 68.
- Answer 1: 16 reports, all of the new run: the row of the images goes from "bitte manuell prüfen" to "erfüllt" with the same numbers.
- Finding 14: 8 captures of one site: the Datenschutz link was a link to another domain in a note of the newsletter form; now it is the site's own link.
- Finding 15: 5 captures of one site: a link "Informationen zur Barrierefreiheit" goes from "vorhanden" to "Link gefunden, bitte prüfen" (the row from `pass` to `manual`, one more manual check).
- Findings 5, 6, 7, 16 and 71 to 74 change no saved report: on the 60 saved Impressum pages every field and every link is the same as before, and all 60 pages still count as an Impressum.
- `npm run scan:local -- --reanalyze` on the new run: the result files differ from those before only by the new field of the links and by the one site of finding 15. `npm run report:check`: 30 of 30 reports valid.

### Blind manual check (new captures of the same 20 sites as in A4)

- Two helpers saw only the saved pages of 10 sites each (text, links, HTML, screenshots), never a result of the scanner, and wrote down the links and the operator's fields. Compared by a script with the scanner's result of the branch.
- Fields: 64 found by the scanner, 0 wrong (63 the same as the reviewer; 1 is the same address in the form of another line of the page, without the floor that the Impressum block adds, judged right). Links: 40 found (Impressum 20, Datenschutz 20), 40 the same, 0 wrong; no link to a statement on accessibility found by either side, and the 2 links that name only the topic are "bitte prüfen" for both. The second tab is the site's Impressum on 20 of 20 for both.
- Not found although on the page as text: 2 of 66 fields, both Handelsregister entries, the same two as in A4 (one without "HRA"/"HRB", one under a heading that names an authority).

### Merge condition of fix-a3 (session message)

- Findings 5, 6, 7, 14, 15 and 16 fixed, each with a test: yes (above).
- Manual check, 0 wrong fields and links: yes, 64 fields and 40 links, 0 wrong.
- `npm test` and the integration tests pass completely: yes. `npm test` 1,196 of 1,196 (1,096 before); `npm run test:integration` 76 of 76 in Chromium (75 before) and 31 of 31 in the worker project. `npm run typecheck`: no errors. One earlier run of `npm test` at the same time as the integration tests stopped two test files of the worker at their start (50 tests skipped, no test failed); alone it passed three times.
- Every change in the reports is explained: yes, 29 changed reports, 0 unexplained changes.
- No secrets, addresses or names of sites, no data of real Impressum pages, no review file and no reproduction scripts in git: yes. 180 search strings (hosts and names of `local/sites.txt` and `local/sites-v1.txt`, the Impressum values of the 30 sites from A4 and from the new run, the reviewers' values) and the value in `worker/.dev.vars`: 0 hits in the 334 tracked files, in the added lines of the branch's commits and in their messages. No tracked path and no tracked line names the review folder. `git ls-files local` is empty. The check found one real register number that had got into a control test of this session; it was replaced by an invented one and removed from the branch's history before the merge (the branch was never pushed).

Result: merged into `main` with `git merge --no-ff`.

### Not done, on purpose

- The other findings of the review, and finding 75 (`docs/backlog.md`).
- Forms of an operator address the template does not read (`docs/backlog.md`): such a page now gives "nicht gefunden, bitte manuell prüfen" for the address, not another address.
- The new report value `legal-datenschutz-uncertain` is not designed.

## fix-a4: the fourth polishing session after the review of stage A (24.11.2026)

Branch `fix-a4`, **merged into `main`**. Session time: about 2 hours 45 minutes (02:01 to about 04:45), longer than the one to two hours of a session: the measurement of the heavy pages ran twice, about 25 minutes each, and the new tests ran once more against the old sources. No Cloudflare, no deploy, nothing pushed, no site visited: everything ran on the laptop (unit tests, the local Chromium against pages on 127.0.0.1, the saved captures). Two helpers (Sonnet): one made the rate-limit change with its tests, one built and ran the measurement of the heavy pages.

Fedor's answers before the start (in `docs/decisions.md`): "Informationen zur Barrierefreiheit" stays "Link gefunden, bitte prüfen"; "DE" plus 9 digits under the label "Steuernummer" is a found USt-IdNr (the code already reads it so); finding 75 is a separate step of the last polishing session.

### What was done

- Findings 4, 10 and 11, limits: one module of limits for everything a page controls (`scanner/src/capture/limits.ts`): 2,000 requests and 500,000 characters of request addresses per page, 2,000 characters per address, 1,500 links (plus 100 legal ones) with 300,000 characters of addresses, 16,000 characters per header value, short bounds for titles, selectors and the accessibility result, 2 MB for a capture. The scripts in the page, both browser adapters and the HTML reader of the quick check use them, and every capture is brought within them once more before it is analysed. A page over the request limit is a failed capture with the new reason `page-limit`: the adapter keeps nothing more and closes the tab at once. A long address is kept cut, a link with an address over the limit is left out.
- Findings 12 and 13: the search for the text of a mailto link in the Impressum is linear and looks at no more than 50 such links; the trimming of the Permissions-Policy value is linear; a header value over the limit is not analysed and is "bitte manuell prüfen".
- Findings 8 and 9: the newest salt is kept when a start crosses midnight UTC, and the time for the limit is read after the name check; at most 15 scans per visitor per UTC day, by the same hash (new table `rate_daily`, migration `0003_rate_daily.sql`); the answer 429 says which limit it was.
- Small findings: 25 (one quick check makes at most 45 requests with the object's trace request; 52 to 53 before), 51 (an analysis that throws leaves its part "nicht geprüft", the others stand), 54 (values of the page go into the report only in the form of the schema; a report over 400,000 characters is made smaller, not thrown away), 61 (the new report field `truncated`).
- Backlog: in the quick check a page that declares no encoding and is not valid UTF-8 is read as windows-1252.
- What the report says at a limit: `failed` with the reason `page-limit` for a page over the request limit; `truncated.page` for a text, a list of links or a header read only up to a limit; `truncated.findings` and `truncated.services` for a list shorter than its count; a missing Impressum link without a risk when the scan did not read every link. Six German draft texts in `docs/content-drafts.md`, the decisions in `docs/decisions.md`, the open points in `docs/backlog.md`, the new values in `docs/report-schema.md`, the rows of the new table in `docs/d1.md`.

### Tests

- Each finding has tests built from the review's reproductions: `scanner/test/capture-limits.test.ts` (41: findings 4, 10, 11, 12, 13, 25, 51, 54, 61 and the encoding), `worker/test/rate-limit-day.test.ts` (17: findings 8 and 9), and the heavy pages of findings 4, 10 and 13 through both adapters in the local Chromium: `worker/test/integration/heavy-pages.test.ts` (10, the Cloudflare adapter) and `scanner/test/integration/heavy-pages.test.ts` (7, the local adapter), pages in `scanner/test/integration/heavy-pages.ts`.
- Run against the code before the fix (a separate checkout of `main` with the new test files; only the two new stand-alone modules were added so that the files load): 28 of the 41 unit tests failed, at least one for every finding (finding 4: 2, 10: 2, 11: 6, 12: 3, 13: 3, 25: 2, 51: 3, 54: 2, 61: 3, the encoding: 2); the other 13 are controls and tests of the new functions alone. Of the rate-limit tests 16 of 17 failed (the seventeenth is the control). The heavy pages: 10 of 10 failed in the Cloudflare adapter (the first by its assertion, the 13 s of requests ran past the 90 s of the test, and the eight after it timed out in the same browser) and 6 of 7 in the local adapter (captures of 30 to 303 MB as JSON; the seventh passes on the old code too). With the fix all pass.
- In that run on the old sources two tests of finding 25 used the real `fetch` for two invented host names (the old code does not know the new option). Both names do not exist (checked by a name lookup), so nothing was requested from any site.
- Four older tests were changed on purpose: three of the HTML reader that named the old encoding rule or the old text of the in-page script, and the "huge page" of `report.test.ts`, which is now a page within the limits of a capture (1,900 requests).

### The heavy pages, measured (step 8 of the session)

- One harness (git-ignored, under `local/`) took every page and every synthetic input of the reproduction scripts of these findings, with the review's headline numbers and with variants of its own, through the adapter the reproduction used: 743 cases, among them 172 pages through both browser adapters, 46 pages in parallel mixes, 33 quick checks and 491 synthetic captures or direct calls; 253 are the helper's own variants (pages that replace the methods the scripts use, floods from an iframe or a web worker, inputs exactly at the limits). Run twice on the code of the branch; 716 of 743 cases gave the same result both times.
- Capture as JSON over 2 MB: 0 in both runs. The largest capture an adapter produced: 969,774 characters (a page that failed with `page-limit`).
- Building and checking the report over 1 s of CPU, on the path of the product (page, capture, report): 0 in both runs. The slowest: 438 ms (1,802 requests to 1,800 unknown hosts).
- Reports with schema problems: 0. The crafted site of finding 25: 45 requests with the trace request (53 without the budget), an ordinary site 6.
- Over 1 s of CPU were only direct calls of single functions with inputs that no capture can hold any more (27 in each run: 100,000 and more requests, links with addresses of 100 KB and 1 MB, a title of 50 MB), and, in the runs under load, the HTML reader of the quick check on three or four synthetic pages of 2 MB (1.1 to 1.3 s; 0.2 to 0.7 s when measured alone). The HTML reader was not changed in this session except for links and the encoding.
- A flood of requests ends as `page-limit` in 0.4 to 2.6 s when the page is alone (the hard limit is 20 s) and in 7 to 10 s beside other floods. An ordinary page beside two floods in the same browser (three scans, as many as the queue runs) was captured as usual every time.

### Saved captures analysed again (no site visited)

- All 287 saved captures under `local/` (219 of real sites, 68 of our own fixture pages), reports built with the code of `main` and with the code of the branch; a script assigned every single change to its cause: 0 unexplained, no state changed.
- Every report changed in exactly one place, the new field `truncated` (finding 61): in 285 it says that nothing is cut; in 2 (both captures of one site, whose Impressum has more than 100,000 characters of text) it names `impressum-text`. No finding, no measure, no service and no link changed in any report.
- The limits themselves change no saved report: 240 request addresses in the saved captures are longer than 2,000 characters and are now analysed cut; the report showed them cut at 300 characters before and after.
- `npm run scan:local -- --reanalyze` on the run of fix-a3: the 32 result files are identical. `npm run report:check`: 30 of 30 reports valid.

### Merge condition of fix-a4 (session message)

- Findings 4, 8, 9, 10, 11, 12 and 13 fixed, each with a test: yes (above).
- Step 8 on every heavy page: yes, 0 captures over 2 MB and 0 reports over 1 s of CPU on the path of the product, in both runs of 743 cases.
- `npm test` and the integration tests pass completely, one after the other: yes. `npm test` 1,258 of 1,258 (1,196 before); `npm run test:integration` 83 of 83 in Chromium (76 before) and 41 of 41 in the worker project (31 before). `npm run typecheck`: no errors.
- Every change in the reports is explained: yes, 287 changed reports, all by the new field, 0 unexplained.
- No secrets, addresses or names of sites, no data of real Impressum pages, no review file and no reproduction scripts in git: yes. 180 search strings (hosts and names of `local/sites.txt` and `local/sites-v1.txt`, the Impressum values of the 30 sites, the reviewers' values) and the value in `worker/.dev.vars`: 0 hits in the 342 tracked files, in the added lines of the branch's commits and in their messages. No tracked path and no tracked line names the review folder or its scripts. `git ls-files local` is empty.

Result: merged into `main` with `git merge --no-ff`.

### Not done, on purpose, and what the measurement showed beside the condition

- The other findings of the review (among them 26, 55 and 57, which the measurement touched: a page can still give the scripts false values; two hosts that differ only in a quote sign get the same finding id).
- A page over the request limit gets a failed report, not a report from its first 2,000 requests (question for Fedor in the report of this session).
- A page that opened WebSocket connections in bursts kept its tab open for up to 38 s although the hard limit is 20 s (the helper's own variant, 2 of 3 runs). With four scans in one browser, three of them floods, the ordinary page failed with a timeout in 3 of 4 runs; the queue runs at most three. Both are in `docs/backlog.md`.
- A long address is kept cut without a mark in the report (the report shows addresses cut at 300 characters anyway).
- A page whose text and links cannot be read (it blocks the browser's script) still gives a `complete` report with the mandatory information "nicht geprüft" and no notice; that was so before this session.
- The new report values are not designed (`docs/report-schema.md`, item 17).

## fix-a5: the fifth polishing session after the review of stage A (24.11.2026)

Branch `fix-a5`, **merged into `main`**. Session time: about 50 minutes (13:19 to about 14:10). No Cloudflare, no deploy, nothing pushed, no site visited: everything ran on the laptop (unit tests, the local D1, the local Chromium against pages on 127.0.0.1, the saved captures). One helper (Sonnet) rewrote the docs for finding 93.

Fedor's answers before the start (in `docs/decisions.md`): a page with more than 2,000 requests stays "Prüfung abgebrochen" without findings (its look in B2); the daily limit of 15 stays until Turnstile; the CPU of the quick check's HTML reader is measured on Cloudflare before the launch (`docs/backlog.md`).

### What was done

- Privacy. Finding 90: page addresses in the stored report keep scheme, host and path; query, fragment, user name and password and a session id in the path are dropped. Kept on purpose: `family` and `display` of a Google Fonts stylesheet (the fix needs the font names) and the page selectors of a legal link on "/" or a script (`?page_id=7`), reasons in `docs/decisions.md`. Finding 91: the rate limit stores one row per visitor and UTC day with the visitor's state encrypted and padded (migration `0004_rate_state.sql`); no time of a visitor is stored in plain form, so nothing joins with the creation time of a scan; the entry of 23.11.2026 that said there was no link is corrected, and what still links (restores minute by minute, a day with a single visitor) is written down. Finding 89: every start counts against a start budget of 20 per hour and 60 per UTC day before the cache lookup; a start beyond it gets 429 `limit: starts` for any address and writes nothing.
- Finding 93: the tracked docs no longer carry findings about single sites; a label "Site NN" stays only next to plain numbers or in a list of a sample. The history is not rewritten.
- Browser budget. Finding 47: the browser closes as soon as no full check runs and the next waiting job would get the quick check. Finding 49: the time of a closed browser counts from its own launch. Finding 50: acquire and connect apart; a failed connection is tried once more, and a session that still cannot be connected counts with its keep-alive of 20 s. WebSocket item of the backlog: in the Cloudflare adapter a socket that Chromium refused before creating it counts against the request limit, and the unused `Log` domain is off.
- Queue and D1. Finding 32: a failed name lookup during a check (resolver error, the subrequests used up) is a failed check of our own, not `not-allowed`. Finding 80: "Unter http:// nicht erreichbar" and `unreachable` only for a failed connection, never for our own failure. Finding 42: a partial index of the scans in progress for the hourly cleanup (migration `0005_scans_in_progress.sql`). Finding 44: the report is written with two more tries; then the scan is our error, and an error D1 does not take is written by the queue's next alarm a minute later. Finding 46: the day cap is read from the queue's storage first; after it every start gets 503 without any D1 read or write. Finding 100: an exception of the Impressum tab fails only the Impressum.
- Finding 31: a unit test of the production queue object `ScanQueueObject` (stub of `cloudflare:workers`, fakes of Browser Run, the capture and the trace page; the start, the queue, the drain, the report and the local D1 are the real code).
- The decisions in `docs/decisions.md`, the open points in `docs/backlog.md`, the new tables and numbers in `docs/d1.md`.

### Tests

- New tests from the review's reproduction scripts: `scanner/test/page-address.test.ts` (90), `scanner/test/own-failures.test.ts` (32, 80), `worker/test/privacy-limits.test.ts` (89, 91, 46), `worker/test/queue-object.test.ts` (31, 46, 47, 49, 44, 50), `worker/test/queue-d1.test.ts` (44, 42); in the local Chromium a WebSocket flood page in `worker/test/integration/heavy-pages.test.ts` and two failing Impressum tabs in `worker/test/integration/cdp-capture.test.ts` (100).
- Run against the code of `main` (a separate worktree of `main` with the new test files; only the two new stand-alone modules and the stub of `cloudflare:workers` were added so that the files load): scanner 8 of 16 failed, worker 17 of 20, integration 3 of 4. Every finding has at least one failing test (90: 3, 32: 4, 80: 1, 89: 3, 91: 2, 46: 3, 47: 1, 49: 1, 50: 2, 44: 4, 42: 1, 100: 2, WebSocket: 1). The passing ones are controls, tests of the new module alone, and the basic run of the object for finding 31, which was a missing test and no defect. On `main` the review's cache probe got 50 of 50 answers, now 14; the six refused starts after the day cap wrote 8 rows each, now 0. With the fix all pass.
- Older tests changed on purpose: the rate-limit tests read the decrypted state instead of `rate_daily` and `rate_events` (the behaviour they check is unchanged); the budget test counts the new table and index rows, and a slot refused by the hour or the day now writes one row (the start counts); two tests of the http check and the quick check give a refused connection as Node's `fetch` reports it (with its cause); the integration case "closed port" uses a port that was really closed, because port 1 is refused by `fetch` itself (now a manual check, finding 80).

### Measured

- WebSocket flood page through the Cloudflare adapter on the local Chromium (the harness of fix-a4, one run each): before 39.3 s, `timeout`, 668,119 protocol messages (332,400 `Network.webSocketClosed` of sockets never created, as many `Log.entryAdded`); after 0.95 s, `page-limit`, 9,180 messages.
- D1 rows written per day at 80 scans and 80 cached answers: 28,642 at the caps of the report, 5,122 at the median, within Fedor's 33,333 (`docs/d1.md`). The hourly cleanup reads by the new index: 3,000 finished scans and one stuck, fewer than 10 rows read (3,000 before).

### Saved captures analysed again (no site visited)

- All 287 saved captures under `local/` (219 of real sites, 68 of our own fixture pages), reports built with the code of `main` and of the branch; a script assigned every changed value to its cause: 0 unexplained.
- Reports that changed: 180 (161 of real sites, 19 of fixture pages), all by finding 90: 990 request addresses and 407 initiator addresses of the evidence lost their query, 5 Impressum links, 5 Datenschutz links and 5 Impressum addresses their fragment. No state, finding, service or plan changed.
- Findings 32 and 80 change no saved report (no saved capture failed in a name lookup; a saved http check keeps its recorded outcome). `npm run report:check`: 30 of 30 reports valid.

### Merge condition of fix-a5 (session message)

- Findings 31, 32, 42, 44, 46, 47, 49, 50, 80, 89, 90, 91, 93 and 100 fixed, each except 93 with a test: yes (above).
- `npm test` and the integration tests pass completely, one after the other: yes. `npm test` 1,296 of 1,296 (1,258 before); `npm run test:integration` 83 of 83 in Chromium and 45 of 45 in the worker project (41 before). `npm run typecheck`: no errors.
- Every change in the reports is explained: yes, 180 changed reports, 1,412 changed values, 0 unexplained.
- No secrets, addresses or names of sites, no data of real Impressum pages, no review file and no reproduction scripts in git: yes. 180 search strings (hosts and names of `local/sites.txt` and `local/sites-v1.txt`, the Impressum values of the 30 sites, the reviewers' values) and the value in `worker/.dev.vars`: 0 hits in the 352 tracked files, in the added lines of the 11 commits of the branch and in their messages. No tracked path and no tracked line names the review folder or its scripts. `git ls-files local` is empty.

Result: merged into `main` with `git merge --no-ff`.

### Not done, on purpose

- The small findings about the honesty of the report, finding 75, "Feld B2" and the rest of the review: the sixth polishing session (Fedor).
- The local Playwright adapter can still keep one kind of page (a loop of large `data:` fetches) past 20 s; it is for development only and costs no browser minutes (`docs/backlog.md`).
- New values for B2: the answer 429 with `limit: starts`, and 503 `daily-limit` also for an address with a cached report.

## fix-a6: the sixth and last polishing session after the review of stage A (24.11.2026)

Branch `fix-a6`, **merged into `main`**; then the brief on `main` (a commit of its own). Session time: about 1 hour (14:12 to about 15:15). No Cloudflare, no deploy, nothing pushed. The local browser visited 5 of the 30 test sites once (homepage and Impressum, 14:37 to 14:38, for "Feld B2"); everything else ran on saved captures and on pages on 127.0.0.1. Two helpers (Sonnet): one deleted strategy (b) and the A2 lab in a separate worktree (its branch was merged into `fix-a6`), one did the blind check of the system detection.

Fedor's answers before the start (in `docs/decisions.md`, the review with Turnstile in `docs/backlog.md`): "heute ausgelastet" after the daily limit also for a cached report; 20 starts per hour and 60 per day per visitor with cached answers, until Turnstile; the slow page of the local adapter stays.

**Stage A is finished**: the six polishing sessions fixed the review's findings named for them; the rest is in `docs/backlog.md`, one line each.

### What was done

- Honesty of the report. Finding 26: axe runs in an isolated world of the main frame in both adapters, so a page cannot give it a false result. 63: first party are only the requested and the final address. 66: a main document that is not HTML is a failed check (`not-html`). 70: "Drei Dinge" by risk first. 77: a header that has no effect or weakens the protection does not count (Referrer-Policy weaker than the default, Permissions-Policy that allows everything, CSP without directives, HSTS with a repeated directive; a CSP meta element only in `<head>`). 79: the redirect is a manual check when the page ended on http://. 81: "Sicherheits-Header" is manual when a header is undecided. 83: a large iframe gives a manual check and no "erfüllt"; a noticeable frame with almost nothing checked makes the part "nicht geprüft".
- Small findings, each under 15 minutes with a test: 67 (the evidence of a confirmed finding shows a request that reached the service), 68 ("Kleinster Textkontrast" without a value is "nicht geprüft"; "Bilder mit Beschreibung" with "0 von 0" stays "erfüllt" by Fedor's answer of 24.11.2026, question in the report), 69 (reason and status of the manual redirect check), 82 (`scan.stopReason`).
- Finding 75 as a step of its own: one strong signal names the system only when it is a header, the generator or the final host; otherwise two pieces of strong evidence, every different file of the system that the site served counting once; only answered requests count; `csrfConfig`, `salesChannelId` and `/bundles/storefront/` are weak.
- "Feld B2": the axe run records the field (4 × 3 grid over the whole page) of every example element and, per other host, of the elements that load its files; the report gives each finding the field of its first example or element.
- Strings of the page (28, 52, 53, 58, 59): only web addresses in `evidence.via`; the e-mail quote of a link is the address, with `source`; link addresses http(s) without user name and password, null instead of shortened; every string well formed and without controls; the schema marks every such field as untrusted, and `docs/report-schema.md` has the rules for stage B in a section of its own.
- Finding 99: strategy (b) and the A2 lab deleted; the SSRF integration test runs on the production queue object, and the A3 check of the accessibility fixture pages on the Cloudflare adapter is a test (16 cases, the same counts with axe in the isolated world).
- Finding 97 in part: the two timing tests of the HTML reader on 2 MB pages took 1.0 to 2.3 s while the whole suite ran (0.33 to 0.54 s alone, the same with the reader of `main`); they now compare with an ordinary page of the same size and take the fastest of up to three tries.
- Decisions in `docs/decisions.md`, every finding of the review not fixed in stage A in `docs/backlog.md`, five German drafts in `docs/content-drafts.md`, the new values in `docs/report-schema.md`, the rule of the system in `docs/cms-fingerprints.md`.

### Tests

- New: `scanner/test/report-honesty-a6.test.ts` (30), `platform-honest.test.ts` (8), `untrusted-strings.test.ts` (30), `field-b2.test.ts` (3), `worker/test/lab-removed.test.ts` (2); in Chromium `scanner/test/integration/hostile-a6.test.ts` (7, local adapter) and 7 cases in `worker/test/integration/cdp-capture.test.ts` (Cloudflare adapter), pages in `scanner/test/integration/hostile-a6-pages.ts`.
- Run against the code of `main` (a separate worktree with the new test files): 65 of the 73 unit tests failed, at least one for every finding (26 in Chromium; 28: 6, 52: 4, 53: 1, 58: 1, 59: 16, 63: 2, 66: 4, 67: 1, 68: 1, 69: 5, 70: 1, 75: 8, 77: 6, 79: 1, 81: 1, 82: 1, 83: 2, 99: 2; "Feld B2": 2); the 8 that passed are controls. In Chromium 6 of 7 failed in each adapter: the four pages that try to fake axe (26), the CSP meta element in `<body>` (77) and "Feld B2"; the honest page passed (the control). With the fix all pass.
- Older tests changed on purpose: the referrer meta value `always` (= unsafe-url) no longer counts, a CSP meta element in `<body>` is not read, five platform cases have two files of the system instead of one, the e-mail quote of a mailto link is the address, the found fields carry `source`, the example of axe has a `field`, and the fake axe of the heavy page of fix-a4 no longer runs (both adapters now report the pinned axe-core).

### Blind check of the system (finding 75)

- One helper saw only the saved homepage of each of the latest 30 captures (HTML, headers, the requests with their status, screenshot), never a result of the scanner, and named the system with its evidence. Compared by a script with the scanner of the branch.
- Named by the scanner 26, different from the reviewer 0 (WooCommerce 4 of 4 the same, Shopware major version 4 of 4 the same). "unbekannt" 4, as before the change; the reviewer called all four "other". On all 287 saved captures no detected system changed.

### "Feld B2" on the test pages and on 5 sites

- A page with three elements at known places: the image without alt in A1, the grey text in B2, the iframe of another host in D3, through both adapters.
- Local run of 5 sites (into `local/fix-a6/`): 5 of 5 captured; axe examples with a field 42 of 42; accessibility findings with a field 5 of 5, manual checks 5 of 8; third-party findings 0 of 7 and hints 3 of 13 (a font or a script loaded from the head has no element with a box: `docs/backlog.md`); 5 of 5 reports valid.

### Saved captures analysed again (no site visited)

- All 287 saved captures (219 of real sites, 68 of our own fixture pages), reports built with the code of `main` and of the branch; a script assigned every changed value to its cause: 0 unexplained.
- Every report changed by the new field `scan.stopReason` (82). Besides: 81, 145 reports (111 of real sites, all captures without the meta tags of the page) go from "teilweise" or "nicht erfüllt" to "bitte manuell prüfen" for the headers; 52, `source` on 194 found fields of 60 reports; 28, 65 initiator addresses (`about:`, `blob:`) of 27 reports become null; 77, one site whose Referrer-Policy is `no-referrer-when-downgrade` (7 reports) has one counted header less; 58, 3 HTML snippets lose a zero-width space; 70, 23 reports of fixture pages put the missing Impressum link first in "Drei Dinge"; 68, 2 fixture pages without text get "Kleinster Textkontrast" "nicht geprüft".
- No state, finding id, service or system changed. `npm run scan:local -- --reanalyze` on the run of fix-a3: the fields and systems as before. `npm run report:check`: 30 of 30 reports valid.

### Merge condition of fix-a6 (session message)

- Findings 26, 28, 52, 53, 58, 59, 63, 66, 70, 75, 77, 79, 81, 83 and 99 fixed, each with a test: yes (above).
- Blind check of finding 75: yes, 26 named systems, 0 different from the reviewer; "unbekannt" 4, as before.
- `npm test` and the integration tests pass completely, one after the other: yes. `npm test` 1,326 of 1,326 (1,296 before); `npm run test:integration` 90 of 90 in Chromium (83 before) and 63 of 63 in the worker project (45 before). `npm run typecheck`: no errors. Before the timing tests were changed (finding 97), five full runs of `npm test` failed only in them (and once in a 5 s timeout of a D1 test); every file passed alone.
- Every change in the reports is explained: yes, 0 unexplained values.
- No secrets, addresses or names of sites, no data of real Impressum pages, no review file and no reproduction scripts in git: yes. 180 search strings and the value in `worker/.dev.vars`: 0 hits in the 350 tracked files, in the added lines of the 13 commits of the branch and in their messages. No tracked path and no tracked line names the review folder or its scripts. `git ls-files local` is empty.

Result: merged into `main` with `git merge --no-ff`.

### The brief (a commit of its own on `main`)

- `<architecture>`: `worker/` is two Workers (the API Worker without browser code, the scan Worker with only the queue object); the checks run in one Durable Object in the EU jurisdiction with strategy (a), which also runs the start, the queue and the scans in its alarm; a new block "Limits from the measurements" (Worker CPU, browser time and the day caps of 540 s, 80 full checks and 150 scans, subrequests, D1 rows, the limits per visitor, the limits of a page).
- `<stage_b>`: a line that every B session follows the section "Strings of the scanned page" of `docs/report-schema.md`.
- Unchanged: owner decisions, goals, the merge conditions of stage B, and the rest of the brief (also its log and the status line at the top).

### Not done, on purpose

- The findings of the review that no session named (`docs/backlog.md`, one line each).
- "Bilder mit Beschreibung" with "0 von 0" (finding 68, owner decision); the field of a finding about a font or a script from the head; the new report values are not designed.

## B1 part 1: app skeleton, fonts, header and footer, visual check, home page (24.11.2026)

Branch `b1-home`, **not merged** (the merge is part of B1 part 2, by the session message). Before the branch, a commit of its own on `main`: the status line of the brief ("Stage A: done (24.11.2026). Stage B: in progress") and two log entries. Session time: about 25 minutes (about 15:22 to 15:47). No Cloudflare, no deploy, nothing pushed, no test site visited, no helpers.

Fedor's answers to the three questions of fix-a6 are in `docs/decisions.md`: "Bilder mit Beschreibung" without images stays "erfüllt" and the report shows "keine Bilder" (the text is a draft in B3); a finding without a field shows no "Feld" label, and finding the elements that use a font is stage D (`docs/backlog.md`); the brief's status line and log are updated.

### What was done

- `web/` as the third workspace: Next.js 16.4.6 with static export, React 19.3.1, TypeScript strict (the base config with bundler resolution), Tailwind CSS 4.3.5 without preflight, the values of `design/tokens.css` as theme variables (`web/app/globals.css`), a unit test that compares every token with its variable.
- Fonts: Barlow 400, 500, 600 and Barlow Semi Condensed 500, 600 with `next/font/local`, latin WOFF2 files of Fontsource 5.3.0 in `web/fonts/` with the OFL license. The built page preloads them from its own host.
- Header and footer as shared components (width 1320 or 1240 px, a slot for the right side of the header).
- Home page in its final state as in `design/reference/start.html` with reduced motion: the drawing with every line drawn, layer 1 highlighted (`aria-pressed`), its note shown; the title block with the address field; the form sends nothing (submit button, `noValidate`). No motion and no layer switching yet.
- Commands: `npm run build:web`, `npm run visual` (builds, then compares; `-- --only start`, `--reference-only`, `--google-fonts`), `npm run preview` (builds, then serves `web/out` on http://127.0.0.1:3000/). `npm run typecheck` includes `web/` (with `next typegen`). Next.js telemetry is off for these commands.
- Decisions in `docs/decisions.md` (preflight, tokens, fonts, the rules of the visual check, the button, the final dash state, telemetry, header and footer), open points in `docs/backlog.md`.

### The reference at 390 px (step 5)

- `design/reference/start.html` at 390 px: no horizontal scrolling, no text outside the viewport, no cut-off text, no overlapping text boxes, by the layout check of `npm run visual` and by eye on the screenshot. Nothing is excluded from the comparison.
- Observation, no fault: the drawing is scaled to 326 of 600 units, so its texts are 5.4 to 7 px high at 390 px (the same in the app, since it is the same drawing).

### Numbers against the conditions of the session message

- Difference from the reference: start 1440 px 0.000 % (0 of 2,095,200 pixels), 390 px 0.000 % (0 of 1,112,280); the strict count without threshold and with anti-aliasing is 0 as well; both screenshots have the same size (1440 × 1455 and 390 × 2852). Before the drawn lines got the final dash state, the share was already 0.000 %, the strict count 0.09 % and 0.25 % (the corners of the drawing). Fitting took about 5 of the allowed 45 minutes.
- Requests of the built page to other hosts: 0 in the visual check at both widths. A separate run (5 s wait, scrolling, typing an address, Enter, hover) made 26 requests at both widths, all to 127.0.0.1; Enter left the address at "/". The built files contain no "googleapis" or "gstatic"; absolute addresses appear only as strings in code (SVG namespaces, links to documentation in the error messages of React and Next.js).
- The font files: the reference with the files from Google and with the files in `web/fonts/` gave 0 different pixels at both widths.
- `npm test`: 1,356 of 1,356 (1,326 before, 30 new in `web/`). `npm run build:web` passes. `npm run typecheck`: no errors. The integration tests were not run (no change in `scanner/` or `worker/`). `git ls-files local` is empty.

### Not done, on purpose (part 2)

- The drawing animation, the transitions, switching the layers, keyboard and focus, the full axe-core run, the merge into `main`.

## B1 part 2: drawing animation, layer buttons, keyboard and focus, axe (24.11.2026)

Branch `b1-home`, **not merged** (by the session message: Fedor looks at the animation first). Session time: about 25 minutes (about 15:50 to 16:15). No Cloudflare, no deploy, nothing pushed, no test site visited, no helpers.

Fedor's answers to the questions of part 1 (`docs/decisions.md`, `docs/backlog.md`): the small text of the drawing stays at 390 px as in the reference; "Website prüfen" is the submit button; the German 404 page is stage C.

### What was done

- The drawing animation with the CSS of the reference: lines drawn in 1.2 s with cubic-bezier(.6, 0, .2, 1), labels, callouts and notes appear in 0.45 s (opacity and scale), 25 elements with the delays of start.html (0.2 s to 3.3 s; the last one ends at 3.75 s). Reduced motion: the final state at once, no animation and no transition.
- The four layer buttons switch the filled callout and the note (transitions of 0.2 s and 0.25 s as in the reference), state in `aria-pressed`; layer 1 on load. The state is a small React context shared by the buttons and the drawing.
- Keyboard and focus need no code of their own: native links, buttons and the field, the focus ring of the reference (3 px cyan at an offset of 3 px). They are measured (below).
- The styles moved from one file into CSS modules next to the components (step 4 of the session message, see "How the home page is built").
- Two new checks with their own commands: `npm run motion` (the animation against the reference) and `npm run a11y` (keyboard, focus by pixels, axe-core; `-- --reference` for the reference); they share `web/scripts/browser-setup.ts` and `image-diff.ts` with `npm run visual`. A unit test compares the 25 animated elements, their delays, shapes and texts with start.html without a browser. CLAUDE.md lists the web commands.

### How the home page is built

- Shared by every page: `web/app/layout.tsx` (the blueprint sheet `.paper`, `lang="de"`, the fonts) and `web/app/globals.css` (the tokens, the base rules of the reference with the focus ring). Header (`web/components/site-header.tsx` with its module: logo mark, navigation, a slot for the right side, width 1320 or 1240 px) and footer (`site-footer.tsx`, the same two widths) go to the scan screen and the report as they are; the navigation of those pages differs and gets its variants in B2 to B4 (`docs/backlog.md`).
- The drawing frame: `web/components/blueprint/sketch-frame.tsx` draws the example web page (window, browser bar, dots, address bar, lock, hero with cross, heading, text line, three cards, footer line) that start.html and pruefung.html share, with the timing each page passes; `drawing.module.css` holds the line styles of both drawings. The scan screen (B2) uses both with its own timings and adds its plotter, red marks and footer texts. The plan in the report (bericht.html) is a different drawing (blue on white, another view box) and does not use it.
- The title block ("Schriftfeld"): on the home page the grid of label and value with the address field (`web/components/home/scan-form.tsx` and its module). The report has a title block of its own with other measures and colours (`.stb` in bericht.html: six fields on white, B4); only the idea of label and value is shared, no styles.
- Home only: `home-drawing.tsx` (the dimension line, the footer texts, callouts and notes, its own `draw` and `pop`), `layers.tsx` (context and buttons), `report-features.tsx` (the three cards). `web/app/page.tsx` puts them together.

### Numbers against the merge condition of B1

- Difference from the reference with reduced motion: start 1440 px 0.000 % (0 of 2,095,200 pixels), 390 px 0.000 % (0 of 1,112,280), the same before and after the styles moved into modules.
- Motion (`npm run motion`, both widths): 25 animations in the app and in the reference, 0 differences in target, keyframes, duration, delay, easing and fill, all started at the same moment (spread 0.0 ms). Frames of the drawing with every animation paused at the same time: at 0.6, 1.4, 2.5 and 3.45 s 0 different pixels at 1440 px (604 × 453) and at 390 px (326 × 246), also in the strict count. Layer switch: 6 transitions in both with the same properties and timings; frames 0.08 and 0.16 s after the click 0 different pixels (strict count: 1 pixel at 390 px, 0.16 s); the drawing after each of the four layers 0 pixels; `aria-pressed` the same as in the reference. Reduced motion: 0 animations on load and 0 after a switch, in both.
- axe-core 4.14.1 (the pinned version of the scanner), every rule on by default (91 rules: 41 passed, the others not applicable), per width in six states (layers 1 to 4, the address field focused, with motion after the drawing finished): 0 violations. Incomplete: color-contrast on 40 elements, because the background is the grid image; measured by pixels behind the text, all 40 have the required ratio against the usual background (lowest 4.89:1, callout "1"). The reference gives the same: 0 violations, the same 40 incomplete.
- Requests of the built page to other hosts: 0 in all three checks at both widths (loading, motion, clicks, keyboard, typing, sending the form); the built HTML and CSS contain no "googleapis", no "gstatic" and no absolute address.
- Keyboard: Tab reaches all 14 controls at both widths in document order (logo, three navigation links, four layer buttons, the field, "Website prüfen", the BFSG card, three footer links), the same 14 as in the reference. Every stop has :focus-visible; the ring covers at least 1.53 times the area of a 2 px line around the control at a contrast of at least 3:1 between focused and unfocused (median 5.69:1; on the white button "Website prüfen" 4,089 pixels at 1440 px for 2,676 needed; on the address field 6.59:1). Layer buttons by Space and Enter: `aria-pressed` and the note follow; Enter in the field and Enter or Space on the button keep the address at "/".
- `npm test`: 1,358 of 1,358 (2 new in `web/`). `npm run build:web` passes. `npm run typecheck`: no errors. Integration tests not run (no change in `scanner/` or `worker/`). `git ls-files local` is empty.

### Observations, no fault of the port (`docs/backlog.md`)

- Right after Tab the browser scrolls a control only until the control itself touches the edge of the window; the part of the ring outside it is then hidden at that edge (1440 px: layer buttons 3 and 4 and "Website prüfen"; 390 px: layer button 4). The reference behaves the same. Question to Fedor in the report.
- Where text crosses a 1 px line of the grid, the contrast at those pixels drops to 2.48:1 at the lowest, for 0.58 % (1440 px) and 0.80 % (390 px) of the background pixels behind text; the same on the reference.
- `package-lock.json` has an uncommitted change that was there before the session (`"peer": true` on five optional packages, written by npm 11); it is in no commit.

## B2 part 1: merge of B1, the scan screen with the example of the reference (24.11.2026)

Branch `b2-scan`, **not merged** (by the session message: Fedor looks first). `b1-home` is merged into `main` (05f9370, a real merge) after the checks of B1 ran again on the branch. Session time: about 45 minutes (about 16:35 to 17:20). No Cloudflare, no deploy, nothing pushed, no test site visited, no helpers.

Fedor's answers after B1 part 2 (`docs/decisions.md`): `scroll-margin: 8px` on the controls, a deviation from the CSS of the reference; the checks run on the branch right before a merge. Fedor's rule for the scan screen: no made-up progress run by a timer.

### What was done

- `package-lock.json` (step 1): npm 11.12.1, bundled with the pinned Node 24.15.0, writes `"peer": true` on five optional packages. From the committed file the first `npm install` gives a third variant (six bundled packages of `@tailwindcss/oxide-wasm32-wasi` marked extraneous); the second and every later run (four runs, and once more after `npm ci`) write exactly the uncommitted change and leave it unchanged. `npm ci` passes; version, resolved and integrity are the same for all 280 entries. Committed on `b1-home` as a commit of its own (e521bbd); after `npm install` the working tree stays clean.
- B1 checks on `b1-home` (step 2), then the merge: numbers below.
- `scroll-margin: 8px` on links, buttons and fields (step 4); `npm run a11y` counts a focus ring past the edge of the window right after Tab as an error (shown: without the margin it finds 4 cut rings on the home page and exits with 1).
- The reference at 390 px (step 5): `design/reference/pruefung.html` has no sideways scrolling, no text outside the window, no cut-off text and no overlapping text boxes, by the layout check of `npm run visual` and by eye; with motion, at 12 moments from 0.35 to 8 s, it does not scroll sideways at 390 or 1440 px. Nothing to report; the small text of the drawing is 5.4 px high at 390 px, as on the home page.
- The scan screen (step 6, `web/components/scan/`): `ScanScreen` with the header ("Prüfung abbrechen", the shared `HeaderAction`), the heading, the plotter (`SketchFrame` with the timings of pruefung.html, rail and carriage, code mark, footer texts, the red marks, the pen), the "Messprotokoll" (time bar, eight steps), "Fertig. Ihr Bericht ist gezeichnet." with "Bericht öffnen", and the footer; CSS modules with the keyframes and reduced-motion rules of the reference. The example of the reference (domain, steps, marks, summary, the times of its compressed run) is one module, `example-scan.ts`; its page `/pruefung/beispiel` is built only for the checks (`page.example.tsx`, `WC_EXAMPLES=1`); the production build has no such page and fails if "roesterei-muster" gets into `web/out` (shown: exit 1 with the page renamed to `page.tsx`). The form of the home page is unchanged.
- `npm run visual`, `motion` and `a11y` check the scan screen (step 7); they build with the example pages. `npm run preview:examples` serves that build. Unit tests: the 41 timed elements of pruefung.html with their delays and durations, the time bar, the shapes, the label of the drawing and every text of the page; only the example page imports the example data.

### Numbers against the conditions of the session message

B1, on `b1-home` before the merge:
- Home against start.html with reduced motion: 0.000 % at 1440 px (0 of 2,095,200) and 390 px (0 of 1,112,280). Motion: 25 of 25 animations without difference, frames at 4 moments and the layer switch 0 pixels. axe 0 violations. 14 of 14 controls by Tab with visible focus. 0 requests to other hosts. `npm test` 1,358 of 1,358, typecheck and `build:web` pass. Merged.

B2 part 1, final run on `b2-scan` (all checks one after the other on the last code):
- Scan screen against pruefung.html with reduced motion: 0.000 % at 1440 px (0 of 1,736,640) and 390 px (0 of 755,430), also 0 in the strict count; same page size. Home still 0.000 % at both widths (0 pixels).
- Motion: 44 of 44 animations of the scan screen without difference in target, keyframes, duration, delay, easing and fill, all started together, at both widths (home 25 of 25). Frames of the whole scan screen at 12 moments (0.35 to 8 s): 0 different pixels at both widths, also in the strict count; no sideways scrolling at any moment. Home: 0 pixels at its 4 moments; layer switch 0 pixels (strict count 23 pixels in one frame, 0.08 s after the click). Reduced motion: 0 animations on both pages at both widths.
- axe-core 4.14.1, every rule on by default: scan screen 0 violations with reduced motion and after every animation, at both widths (36 rules passed of 91); home 0 in all six states. Incomplete color-contrast measured by pixels: scan screen 32 elements, 0 under the required ratio against the usual background, lowest 4.89:1; home 40 elements, lowest 4.89:1 as in B1.
- Keyboard: scan screen 6 of 6 controls (logo, "Prüfung abbrechen", "Bericht öffnen", three footer links) in the order of the reference at both widths; home 14 of 14 in the order of the reference. Every stop has :focus-visible; the ring covers at least 1.59 times the area of a 2 px line at 3:1 or more (scan screen), 1.53 (home); right after Tab every ring is whole in the window on both pages (the reference home page without the margin: 3 rings cut at 1440 px, 1 at 390 px).
- Requests to other hosts: 0 on both pages in visual, motion and a11y at both widths; the built scan page and CSS contain no absolute address and no "googleapis" or "gstatic".
- `npm test` 1,363 of 1,363 (5 new in `web/`). `npm run typecheck` no errors. `npm run build:web` passes and reports no example data in `web/out`. Integration tests not run (no change in `scanner/` or `worker/`). `git ls-files local` is empty.
- Fitting to 1 %: one change (the heading as one string; 2 pixels before). About 15 minutes went into the motion check itself (the 1 px borders of the reference, `docs/decisions.md`).

### Observations (`docs/backlog.md`)

- In the middle of the run (3.3 s) the steps that have not lit up are at opacity 0.32: contrast 2.17 to 2.49:1, in the app and the reference alike; axe leaves them "incomplete" (the grid behind the panel).
- In the reference "Bericht öffnen" is in the Tab order while it is invisible (until 7.4 s); the example page keeps that, the real page of part 2 should not.
- The scan screen needs a title; "Prüfung läuft, Website-Check DE" is a draft.

### How to look at it

- `npm run preview:examples`, then http://127.0.0.1:3000/pruefung/beispiel (stop with Ctrl+C); the reference `design/reference/pruefung.html` beside it. With reduced motion switched on in the system the page shows the final state at once.
- `npm run preview` is the production build: there `/pruefung/beispiel` gives 404.

## B2 part 2: the form starts a scan, the real scan screen, "Prüfung abbrechen" (24.11.2026)

Branch `b2-scan`, **not merged** (session message: B2 has three parts, the merge condition is part 3's). Session time: about 1 hour 15 minutes (17:58 to 19:12). No Cloudflare, no deploy, nothing pushed, no listed site opened: every scan ran against fixture pages on localhost. One helper (Sonnet), a read-only review of the code: no deadlock, no cancelled job that could still capture, no token that cancels another visitor's scan; 11 points, 9 fixed (among them: a job a run had taken but that still waited for the browser could not be cancelled; the form stayed dead after "Zurück"; a modifier click cancelled the scan; "Bericht öffnen" was focusable while its panel waited invisible), 2 rare races and the missing visitor limit of the cancel call in `docs/backlog.md`.

Fedor's answers to the three questions of part 1 and his rules for part 2 are in `docs/decisions.md` (owner decisions of 24.11.2026, B2 part 2); the technical decisions of the session follow them in the technical section.

### What was done

- API (`worker/`): `POST /api/scans/{id}/cancel` with the visitor's cancel token, answered 204 whatever the queue did. The start hands out a token; a start answered from the cache with a scan that waits or runs joins it with a token of its own. The queue keeps the tokens with the job and removes it only when the last token is gone and it has not started; cancel, join and the start of the next job run one after the other, and the D1 write of a cancel happens inside that order. A cancelled scan is `error` with the reason `cancelled`. The status carries `displayHost`.
- Report (`scanner/`): `scan.requests` (`total`, `thirdParty`), optional in schema v1.
- Form (`web/components/home/scan-form.tsx`): starts the scan, keeps address and token in the tab's sessionStorage, leads to `/pruefung?id=…`; one temporary message for every refused start.
- Scan screen (`web/app/pruefung/page.tsx`, `web/components/scan/live-scan.tsx`, `web/lib/scan-view.ts`): polls every 2 s (not while the tab is hidden); in the queue the place, then "läuft", then the report: the rows with its numbers light at once, the marks of its priorities, the summary, "Bericht öffnen" to `/bericht?id=…`. Before the report: waiting rows with the names of the steps at 5.15:1, no tick, no number, no mark, no link to the report. Drawing, pen and carriage at 0.68 of the reference's times (pen ends at 4.96 s); the time bar in real time from the scan's start, never at the end without the report. One `role="status"` line from the first paint. The report is validated with the scanner's validator in the browser; strings of the site and the visitor are text in `<bdi>`. `noindex` by meta element and `X-Robots-Tag`. The example page `/pruefung/beispiel` keeps the values and times of the reference.
- Local path: `npm run dev:local` (the production build served by the API Worker with Workers Static Assets, both Workers on plain `wrangler dev` with the local Chrome, a fresh local D1, three fixture sites of an invented business); the end-to-end test `worker/test/integration/scan-screen-dev.test.ts`; `npm run check:scan` for the real screen in its three states.
- Docs: `docs/d1.md` (requests of one scan screen), `docs/content-drafts.md` (drafts of part 2), `docs/backlog.md` (part 3 and the B5 item: our site passes our own check), `CLAUDE.md` (the two new commands).

### Numbers against the conditions of the session message

- Step 1 and 4, end to end on local `wrangler dev` with the local Chrome (fixture site): home → form → `/pruefung?id=…` → "Die Messung ist fertig" → "Bericht öffnen" → `/bericht?id=<id>`: passes; the scan took about 4 s, rows "Seite aufgerufen", "{n} Anfragen aufgezeichnet", "Impressum gefunden, unter /impressum", "Pflichtangaben gelesen, Anschrift, E-Mail, Handelsregister, USt-IdNr." from the report. Cancel in the queue (one scan at a time, a slow site running): the waiting scan shows "Platz 1", "Prüfung abbrechen" sends the cancel (204) and leads home, the scan is `error`, its fixture site got 0 requests, the running scan ended `complete`. 2 of 2 tests, about 50 s.
- Step 3, cancel tests: queue core 9 new tests (a cancelled scan: the run starts 0 jobs and 0 browsers; a joined scan stays and runs; a running scan answers "running" and ends normally; a job the run took that still waits for the browser is cancelled, its capture never runs, the browser is closed; wrong tokens change nothing; a job of older code without tokens is not cancelled by a joining visitor; a join and a take at the moment of a cancel wait and find the scan gone; a half cancelled job left by a lost run is dropped; at most 50 tokens). The production queue object with the local D1: 4 new tests (0 browsers for a cancelled scan and a new scan for the same address afterwards; a joined scan runs to its report; a running scan is not stopped; wrong or malformed requests change nothing). The API route: 3 new tests (204 without body, refusals before the queue, 503 without the queue).
- Step 5, the example page against the reference (`npm run visual`, `npm run motion`): scan screen 0.000 % at 1440 px (0 of 1,736,640) and 390 px (0 of 755,430), home 0.000 % at both widths; 44 of 44 animations without difference, frames at 12 moments 0 pixels at both widths; home 25 of 25, layer switch 0 pixels.
- Step 5, the real scan screen (`npm run check:scan`), queued, running and ready, at 1440 and 390 px: axe-core 4.14.1 0 violations in all 6 states; contrast by pixels where axe could not decide (24 elements waiting, 35 ready): 0 under the required ratio against the usual background, the lowest 5.15:1 for the waiting rows and 4.89:1 for the mark "1" (as on the reference); Tab reaches every control (5 before the report, 6 with "Bericht öffnen") with the focus ring at least 1.59 times the required area at 3:1 and whole in the window; "Bericht öffnen" not in the page before the report, and with the report there at load hidden and out of the Tab order until its panel rises (visible 5 s later); reduced motion 0 animations in all states; with motion 20 animations at load, the longest 4,964 ms, the time bar the only longer one (it runs while the scan runs), after the report the longest new one ends 1.5 s after it, with the report there at load the longest 4,964 ms; the status region changed 4 times for 6 status answers (place 2, place 1, running, ready; three equal answers gave no change); the status asked 2.0 s apart at the shortest. Requests to other hosts: 0 in visual, motion, a11y and check:scan.
- `npm run a11y` (home and example): axe 0 violations, 14 of 14 and 6 of 6 controls in the order of the reference, every ring whole in the window.
- `npm test`: 1,402 of 1,402 (1,363 before). `npm run test:integration`: scanner 90 of 90, worker 65 of 65 (with the 2 new end-to-end tests). `npm run typecheck`: no errors. `npm run build:web`: passes, routes `/`, `/_not-found`, `/pruefung`; no `/pruefung/beispiel` and no "roesterei-muster" in `web/out`. `git ls-files local` is empty.
- `docs/d1.md`: one status request is 1 Worker request, 1 D1 query and 2 rows read (1 request to the queue object while waiting); the report 1 query, 1 row; a scan of 30 s about 18 Worker requests and 33 rows read; at the cap of 150 scans a day about 5,000 Worker requests and 9,500 rows read.

### Not done, on purpose (part 3)

- The states without design and the end-to-end path on three sites, the merge condition of B2 (`docs/backlog.md`).

### How to walk the path yourself

- `npm run dev:local` (builds the site, then http://127.0.0.1:8787/; stop with Ctrl+C). Enter `localhost:8791` in the form and press "Website prüfen": the scan screen follows the scan (about 5 s) to "Bericht öffnen" (the report page itself is B3, so it shows the 404 page).
- The queue and "Prüfung abbrechen": start `localhost:8792` (about 10 s) in one tab, then at once `localhost:8793` in a second tab: it shows "Platz 1 in der Warteschlange"; "Prüfung abbrechen" leads home and the scan never runs.
- `npm run check:scan` and `npm run test:integration` repeat the checks.

## B2 part 3: the states without design, the end-to-end path on three sites, the merge condition of B2 (24.11.2026)

Branch `b2-scan`, **not merged** (session message: Fedor looks at the new states first; the merge is the first step of B3). Session time: about 1 hour 10 minutes (22:36 to 23:45). No Cloudflare, no deploy, nothing pushed. Three listed sites were visited locally through `npm run dev:local` (homepage and Impressum, no clicks), each twice: once on the code before the review, once on the final code. One helper (Sonnet), a read-only review of the branch: 11 findings, 7 fixed, 3 fixed in part, 1 open (`docs/backlog.md`); no leak of example data, no stored error text in the API, no markup from the scanned page.

Fedor's answers to the three questions of part 2 and his rules for part 3 are in `docs/decisions.md` (owner decisions, B2 part 3); the technical decisions follow in the technical section.

### What was done

- Step 1, the marks (Fedor's answer 1): a priority gets the mark of the design in its measured field (B2 heading, A2 subline, A3 code mark: the fields the reference names, and the same 4 × 3 grid over the drawn page), or the code mark by meaning (a third-party request made by the page's own code, the page language); any other priority gets none. Two priorities at one place share the mark ("1, 2"); the description of the drawing names the field or "im Quelltext".
- Step 2, the states without design from elements of the reference (`web/lib/scan-view.ts`, `web/lib/form-view.ts`, `web/components/home/scan-form.tsx`, `web/components/scan/`): every refused start of the form (empty field, invalid, not found, not allowed by rule, the visitor's limits by hour, day and starts, "heute ausgelastet", our errors, no answer); the scan screen for each kind of report (quick check, blocked, failed by reason, refused, almost empty page) and for a scan without a report (cancelled, the day's cap, our error, unknown, unreadable), no connection; rows "nicht geprüft" without a tick; the API status names why a scan ended (`errorReason`, a closed list). The temporary messages of part 2 are gone. Every new text is a draft (`docs/content-drafts.md`, "Session B2 part 3").
- Example pages for each state (`npm run preview:examples`): `/pruefung/beispiel/<state>` (19) and `/beispiel/formular/<state>` (11), built with the scanner's own `buildReport` from captures of the invented shop; the production build fails on a path with "beispiel".
- Step 3: the reports of all 292 saved captures built by the code of `main` and by the branch (no site visited): the only change is the new field `scan.requests` (289 with numbers, 3 `null` where third parties were not checked); both validators 292 of 292; `thirdParty` equals the sum of the services' requests in 289 of 289. `npm run scan:local -- --reanalyze` passes.
- Step 4: the end-to-end path on three sites (below).
- Step 5: the review and its fixes (an unreadable report no longer says "nicht nachgemessen", accessibility with a type axe could not check is "nicht geprüft", a block met by the quick check names no browser, the Impressum place keeps its query, a cut finding still counts, our error claims nothing about the site, a refusal of a changed address is not shown, three 404 before a scan of this tab is "unknown", the tab title follows the state, a timeout without `AbortSignal.timeout`).
- `npm run check:scan` checks every state at both widths (`CLAUDE.md`).

### End to end on three sites (step 4)

Rule written before the first run: in the order of `local/sites.txt`, the first site whose latest saved analysis shows WordPress, the first with Shopify, the first with Wix; blocked or failed ones skipped. That gave three sites, one on each of these systems. Final run on the final code, one line per site, without labels, sorted by the time to "Bericht öffnen":
- `complete`, "Bericht öffnen" after 17.5 s; 174 requests, 39 to third parties, 4 services before consent (three names and "und 1 weiterer"), 7 findings, 3 priorities, 4 manual checks: every value on the screen equals the report. Marks: priorities 1 and 2 share one code mark "1, 2" (two services requested by the page's own code); priority 3, a service requested by another service's tag, has none.
- `complete`, after 24.3 s; 227 and 220 requests, 0 services, 2 findings, 2 priorities, 3 manual: all equal. Marks: 0 (priority 1 in field D1, where the design has no mark; priority 2 without a place on the drawing).
- `complete`, after 24.9 s; 452 and 212 requests, 0 services, 1 finding, 1 priority, 4 manual: all equal. Marks: 0 (priority 1 has no place on the drawing).
- The banner time, the Impressum place and the fields on the screen equal the report on all three.
- Each report valid with our validator and with Ajv; the same screen at 390 px shows the same values; the page with the id and the status API answer `noindex`; 0 requests of our pages to other hosts. The first run (code before the review) gave the same result with other numbers of the live sites (the same marks).

### Numbers against the merge condition of B2

Brief: the scan screen differs by at most 1 % (final state with fixture data); end to end home → scan → report works for 3 sites in local development; reduced motion shows final states. Session message, at both widths:
- Example against the reference: scan screen 0.000 % at 1440 px and 390 px (0 pixels); 44 of 44 animations without difference, frames at 12 moments 0 pixels at both widths; home 0.000 % at both widths, 25 of 25 animations, layer switch 0 pixels.
- Real scan screen and form in every state (`npm run check:scan`): queued, running, ready, 17 more states of the screen, 3 sequences, 10 refused starts of the form, each at 1440 and 390 px: axe 0 violations; contrast where axe could not decide measured by pixels, lowest 4.89:1 (needs 4.5; the same lowest value as on the reference), waiting rows 5.15:1, 0 under the required ratio; Tab reaches every control (5 or 6 on the screen, 14 on the home page) in document order, ring at least 1.59 times the required area at 3:1, whole in the window; reduced motion 0 animations in every state; with motion everything but the time bar ends within 4,964 ms; every state change reached the status region once (part 2 sequence 4 changes for 6 answers, the new sequences 4 for 8, 2 for 3, 2 for 3); the form's message reached its alert region (there from the first paint) every time, the field tied by `aria-describedby`, `aria-invalid` only for the address, the focus back in the field, typing clears it.
- `npm run a11y` (home and example): axe 0, 14 of 14 and 6 of 6 controls in the order of the reference, every ring whole in the window.
- Pages with the id of a scan: `noindex, nofollow` by meta element and `X-Robots-Tag` (measured on `wrangler dev`), the API `noindex, nofollow, noarchive`.
- Requests to other hosts: 0 in visual, motion, a11y, check:scan and the end-to-end runs.
- `npm test` 1,422 of 1,422 (1,402 before); `npm run test:integration` scanner 90 of 90, worker 65 of 65; `npm run typecheck` no errors; `npm run build:web` passes: routes `/`, `/_not-found`, `/pruefung`, no path with "beispiel" and no "roesterei-muster" in `web/out`.
- No name, address or data of a test site in git: the search over 171 strings (hosts and names of both site lists, Impressum values) finds 0 real hits in the 422 tracked files, the added lines of the 23 commits of the branch and their messages; the only matches are false ones, a short part of one host name inside an identifier of our code (7 tracked files with this one, 18 places in added lines). `git ls-files local` is empty.

### How to look at the states

- `npm run preview:examples`, then http://127.0.0.1:3000/ and the addresses below, in the browser at full width and at 390 px (the device toolbar of the browser); stop with Ctrl+C.
- Scan screen: `/pruefung/beispiel` (the reference) and `/pruefung/beispiel/` + `warteschlange`, `laeuft`, `keine-verbindung`, `ohne-funde`, `impressum-auf-startseite`, `ohne-impressum`, `schnellpruefung`, `blockiert`, `zeitlimit`, `serverfehler`, `seitenlimit`, `keine-webseite`, `nicht-erlaubt`, `fast-leer`, `abgebrochen`, `ausgelastet`, `fehler`, `unbekannt`, `bericht-unlesbar`.
- Form: `/beispiel/formular/` + `leer`, `ungueltig`, `nicht-gefunden`, `port`, `nicht-oeffentlich`, `stunde`, `tag`, `starts`, `ausgelastet`, `fehler`, `keine-antwort`.
- The real path: `npm run dev:local` as in part 2.

### Not done, on purpose

- The merge into `main` (session message: first step of B3).
- Review findings left open and observations (`docs/backlog.md`, B2 part 3): the code mark trusts `via` on the site's own host (the report has no initiator type), no pending state of the form, the lead text and scale of the reference in every state, a cut list of services.

## B3 part 1: merge of B2, the upper part of the report with the example JSON (25.11.2026)

Branch `b3-report`, **not merged** (session message: Fedor looks first). `b2-scan` is merged into `main` (d86a6c3, a real merge) after its history was checked by the rule of finding 93 and its checks ran again. Session time: about 1 hour (23:49 to about 00:50). No Cloudflare, no deploy, nothing pushed, no listed site opened, no helpers.

Fedor's answers to the questions of B2 part 3 and his rules for this part are in `docs/decisions.md` (owner decisions of 25.11.2026); the technical decisions follow in the technical section.

### Step 1: the history of `b2-scan` by the rule of finding 93

- Searched: the tracked files, the added lines of the 25 commits of the branch and their messages. Two places broke the rule, both in `docs/progress.md` of B2 part 3: the end-to-end paragraph put the system, the banner time, the findings and the marks of each of the three sites next to its label, and the line of the leak search named the identifier that holds a short part of a host name.
- Rewritten before the merge (the branch was never pushed): the last two commits of the branch, which alone added these lines (15b4f0b is now 6017620, f43c6ed is now e7b0dc3); only those lines changed. The end-to-end paragraph now gives one line per site without a label, sorted by time; the leak line says "a short part of one host name inside an identifier of our code".
- After: 0 labels "Site NN" in the added lines of the 25 commits, 0 in their messages.

### Step 2: the checks of B2 on `b2-scan`, then the merge

- `npm run check:scan` 0 problems (every state at 1440 and 390 px, 0 requests to other hosts); `npm test` 1,422 of 1,422; `npm run typecheck` no errors; `npm run build:web` passes without example data; `npm run test:integration` scanner 90 of 90, worker 65 of 65; `npm run visual` home and scan screen 0.000 % at both widths; `npm run motion` 25 and 44 animations without difference, every frame 0 pixels, reduced motion 0 animations; `npm run a11y` 14 of 14 and 6 of 6 Tab stops in the order of the reference, axe 0, 0 problems.
- The first full run failed in `test:integration`, `visual`, `motion` and `a11y`, at the build: new files of this session, not yet committed, lay in `web/` (a type error in the report screen). With them moved out of the tree, the four checks passed on the branch as it was.
- Leak search over the full list of fix-a3 to fix-a6 plus the Impressum values and hosts of the three reports of B2 part 3 (188 strings, `local/tools/leak-check-b3.ts`): 0 real hits in the 422 tracked files, the added lines of the 25 commits and their messages; the 30 matches (13 in 6 tracked files, 17 in added lines) are all one short part of a host name inside one identifier of our code. `git ls-files local` is empty.
- Merged with `git merge --no-ff` (d86a6c3). Branch `b3-report` from it.

### Step 4: the reference `bericht.html` at 1440 and 390 px

- 1440 px: no sideways scrolling, no text outside the window, nothing cut off.
- 390 px: the page does not scroll sideways. The 62 texts outside the window all lie in the four boxes that scroll sideways inside the sheet (the tables Prüfmaße, Stückliste and Revisionen at 640 px, the Zeitschnitt at 720 px), as WCAG 1.4.10 allows for data tables. One small fault of the reference: inside the Zeitschnitt the line "Einwilligungsbanner erscheint nach 1,4 s" runs 6 px past its 720 px box (still inside the scrolling box). No deviation needed, no place left out of the comparison for this reason.

### Step 5: what was built

- `web/components/report/`: the report screen with the header of the report (navigation without "Für Agenturen", "Neue Prüfung"), the head (heading with `site.displayHost` in `<bdi>`, the three actions as buttons without behaviour, the four facts), the Prüfmaße, "Drei Dinge" with the plan (zones A to D and 1 to 3, the red marks of the design, "Feld …" captions), the Zeitschnitt A–A (rows, bars, ticks, cut, banner time, legend) and the last line of every report. `web/lib/report-view.ts` (pure functions) and `web/lib/report-texts.ts` (texts: the reference, or drafts in `docs/content-drafts.md`, "Session B3 part 1").
- Rendering by "Strings of the scanned page": every string a text node, hosts in `<bdi>`, templates filled in one pass, an unknown text id gets "Vorrangiger Punkt", no HTML from the report.
- The example: `web/components/report/example-report.json`, the scanner's `buildReport` from a capture of the invented shop with the numbers of the reference (`web/scripts/example-report-source.ts`, written by `node web/scripts/make-example-report.ts`); valid by our validator and by Ajv (unit test and at build time). Page `/bericht/beispiel` only in the example build; the production build has no such page and no "roesterei-muster".
- The marks of the plan are those of the scan screen (Fedor's answer 3): for the example the heading (1, Feld B2), the source code (2, Feld A3) and the subline (3, Feld A2), as in the reference.
- At 390 px the boxes of the Prüfmaße and the Zeitschnitt scroll sideways inside the sheet and take focus while they scroll (`ScrollBox`), as Chrome does for the reference by itself.
- Product rule 3: the accessibility statement not found is "nicht gefunden" and "bitte manuell prüfen", not "fehlt" and "nicht erfüllt" as in the reference (conflict 14).

What the reference's upper part shows that schema v1 does not express, or the builder does not make (the example sets the second group by hand, `web/scripts/example-report-source.ts`):
- Not in schema v1: which kind of files the site's own files are ("Ihre Dateien: Design und Skripte"); the app shows "Ihre Dateien". This is the only difference left in the comparison.
- In schema v1, but not made by the builder: "Feld B2" for Google Fonts and "Feld A3" for Google Analytics (a font of the head and a script have no box, gap 1 of `docs/report-schema.md`); the row "Einwilligungstool, Ihr Server" (gap 4); the three priorities of the reference (the builder would take the Google tag before the contrast, risk first).
- Decided against the reference: the row of the accessibility statement (above). Not data: the behaviour of the three actions of the head (the reference has none).

### Step 6: the checks know the report

- `npm run visual` and `npm run motion` compare `/bericht/beispiel` with `bericht.html` from the top of the page to the bottom of the fourth section of the sheet (head, Prüfmaße, "Drei Dinge", Zeitschnitt); the reference gets the decided wording of the row of the accessibility statement in the browser before the comparison, and `visual` prints the number against the unchanged reference too. `npm run a11y` checks the report and leaves the controls of the later sections out of the reference's Tab order; a box that scrolls sideways counts as a Tab stop; the contrast by pixels scrolls such boxes so that each text is measured whole in view.

### Numbers against the conditions of the session message (final run, all checks one after the other)

- Ready blocks against the reference with reduced motion: 0.008 % at 1440 px (228 of 2,733,120 pixels) and 0.020 % at 390 px (228 of 1,152,060), the same page height; the 228 pixels are ": Design und Skripte". Against the unchanged reference (without the decided wording): 0.341 % and 6.549 % (at 390 px the longer text of the decided row wraps other cells, the table is 48 px higher). Home and scan screen 0.000 % at both widths (0 pixels).
- Motion of the ready blocks: 6 of 6 animations (the three marks of the plan and their numbers) without difference in target, keyframes, duration, delay, easing and fill, all started together, at both widths; frames at 10 moments from 0.3 to 2.5 s: 0.008 % and 0.020 % (the same 228 pixels in every frame; the frames of different moments differ from each other, so the marks move); no sideways scrolling at any moment. Reduced motion: 0 animations. The longest motion of the reference ends at 2.35 s: nothing longer than 5 s, nothing to shorten in part 2. Home 25 of 25 and scan screen 44 of 44 animations, every frame 0 pixels.
- axe-core 4.14.1, every rule: report 0 violations at both widths, with reduced motion and after every animation (the reference has 3 `scrollable-region-focusable` at 390 px); home and scan screen 0. Contrast where axe could not decide, by pixels: report 18 texts at 1440 px and 42 at 390 px, 0 under the required ratio against the usual background, lowest 5.27:1 (needs 4.5); home and scan screen lowest 4.89:1 as before.
- Keyboard: report 14 of 14 Tab stops at 1440 px and 16 of 16 at 390 px (with the two scrolling boxes) in the order of the reference (its 9 and 10 stops in parts not built yet left out); every stop with `:focus-visible`, the ring at least 1.44 times the required area at 3:1 (the link "BFSG-Prüfschema" at 390 px; 1.55 at 1440 px), whole in the window right after Tab. Home 14 of 14, scan screen 6 of 6.
- Requests to other hosts: 0 in visual, motion, a11y and check:scan.
- `npm test` 1,437 of 1,437 (1,422 before; 15 new in `web/test/report-view.test.tsx`), five runs; one earlier run had one timing test of the scanner over its 5 s (5.38 s; 458 ms alone); the test of the example report no longer starts a second node process beside it. `npm run typecheck` no errors. `npm run build:web` passes: routes `/`, `/_not-found`, `/pruefung`; no path with "beispiel" and no "roesterei-muster" in `web/out`. `npm run check:scan` 0 problems (it uses the changed contrast function; its numbers are those of B2). `git ls-files local` is empty; leak search over the 6 commits of `b3-report`: 0 hits.

### How to look at it

- `npm run preview:examples`, then http://127.0.0.1:3000/bericht/beispiel at full width and at 390 px (the device toolbar of the browser), next to `design/reference/bericht.html`; stop with Ctrl+C. With reduced motion switched on in the system the marks of the plan stand at once.
- `npm run visual`, `npm run motion`, `npm run a11y` repeat the comparison; images in `local/visual` (`bericht-*-diff.png`, `bericht-*-diff-as-is.png`), `local/motion`, `local/a11y`.

## B3 part 2: the report for a real id, the states of its upper part, the initiator type, latin-ext (25.11.2026)

Branch `b3-report`, **not merged** (session message: Fedor looks at the new states first; the merge is the first step of B4). Session time: about 1 hour 25 minutes (00:53 to about 02:18). No Cloudflare, no deploy, nothing pushed, no listed site opened: the reports of real sites were built again from saved captures, the end-to-end path ran on a fixture site of `npm run dev:local`. One helper (Sonnet), a read-only review of the commits of this part: 10 findings, 7 fixed (no Zeitschnitt on an almost empty page; the latin-ext range overlapped the latin subset, so "ı", "œ" or a decomposed umlaut loaded a latin-ext file without a glyph for them; the notes of cut lists named lists the page does not show yet; a country "XX"; three rounds without a pause for a done scan whose report answers 409; no announcement when the state replaced the loading text; keys of the report picked prototype values of our text tables, and a text id "constructor" made the page throw), 3 in `docs/backlog.md` (the type `preload`, the matching of initiators in the local adapter, the actions of the head until B4).

Fedor's answers to the three questions of B3 part 1 and his rules for this part are in `docs/decisions.md` (owner decisions of 25.11.2026, B3 part 2); the technical decisions follow in the technical section.

### What was done

- Step 1, the report page of a real id (`web/app/bericht/page.tsx`, `web/components/report/live-report.tsx`, `web/lib/report-page.ts`): the report from `GET /api/scans/{id}/report` after its version and both checks of `fetchReport`; 404 is "not found"; 409 asks the status (waits or runs: "Der Bericht ist noch nicht fertig." with "Zur Prüfung"; ended without a report: cancelled, the day's cap, our error); no usable answer (no connection, a server error, a report that fails the validator) three times, then our error with "Neu laden". `noindex, nofollow` and `no-referrer` by meta elements and by `web/public/_headers` (`X-Robots-Tag`, `Referrer-Policy`).
- Step 2, the states without design of the upper part, from elements of bericht.html (`web/lib/report-view.ts`, `web/components/report/`): a note in the dashed box of the "Revisionen" for the quick check, a blocked, refused or failed check by its reason, an almost empty page, a page still loading after 15 s and lists and texts read only in part; the country of the visit as the fifth fact ("Aufgerufen aus"); "System nicht geprüft" and "Geprüfte Seiten keine" when the homepage did not load; "keine Bilder" and "nicht ermittelt" in the Prüfmaße, "bitte manuell prüfen" and "nicht geprüft" as before; the heading of "Drei Dinge" by the number of priorities (none: "Keine vorrangigen Punkte"), no such section and no plan without a measured homepage; the plan without fields (no mark, no caption); the Zeitschnitt without a banner, with a banner after the window, without a third party. A report whose homepage did not load shows only its head and the note. Every new text is a draft (`docs/content-drafts.md`, "Session B3 part 2"). 29 example pages `/bericht/beispiel/<state>`, each a report of the scanner's own builder or a state of the page.
- Step 3, two optional fields of schema v1 (`scanner/`): `evidence[].initiatorType` (the browser's initiator type in a closed list) and `timeline.rows[].fileTypes` (the types of the site's own files of a row). The mark "im Quelltext" of the scan screen and of the plan stands only for a request the HTML parser found in the homepage itself (`inPageSource`, which B4 uses for "Gefunden im Quelltext"); "Ihre Dateien: Design und Skripte" and the other words only when the files are of these types (Fedor's answer 1). The example loads its images after the window and has the link of Google Fonts and the Google tag in its source, so the reference's words are true of it.
- Step 4, latin-ext (Fedor's decision): Barlow and Barlow Semi Condensed in the latin-ext subset from the same Fontsource packages, faces of their own with the unicode-range of latin-ext, not preloaded, first in the font lists. Measured in the browser: the home page, the scan screen, the example report and a report without such letters load the same five latin files as before and no latin-ext file; the example with the domain kawa-łódź-muster.de loads one more file (Semi Condensed 600) and draws all 19 letters of the domain in Barlow; a probe "Łódź Dvořák Şahin Жук Ωμέγα" is drawn with 19 glyphs of Barlow and 8 of the system font (Arial, the Cyrillic and Greek letters).
- `npm run check:report` (`web/scripts/report-check.ts`, `CLAUDE.md`): the real report page with the API answered by the script, every state at both widths, and the report files of saved captures with `--reports`.

### Step 5: the reports of all saved captures built again (no site visited)

- 292 captures, built before the session (code of the branch at its start, 00:55) and after, compared by a local tool: in 292 of 292 the only change is the two new fields (2,542 request evidence entries with `initiatorType`: parser 1,048, script 1,085, preflight 91, other 64, null 254; 1,539 rows of the Zeitschnitt with `fileTypes`, an array on every row of the own files and null on every other row); everything else equal, also the network rows, the platform signals and the services; our validator and Ajv 292 of 292.
- The mark "im Quelltext" by the new rule: among the 162 third-party priorities without a field, 97 had the mark by the old rule, 58 have it by the new one (39 removed: requests made by a script, by a style sheet or a file of the site, 0 added).
- `npm run scan:local -- --reanalyze` passes.

### Step 6: the report page drawn on the reports of the 30 latest saved captures (no site visited)

- The 30 captures saved last (all `complete`, built again by a local tool), each report through the real page with the API answered by the script, at 1440 and 390 px: 60 of 60 without a problem: every value on the page (heading, facts, every Prüfmaß with target, value and result, the number, area, risk and field of each priority, the number of the marks, every row of the Zeitschnitt with its label and small line, the cut, the note, the last line) equal to an independent reading of the JSON in the script (a self-test with five changed values sees all five); axe-core 0 violations; at 390 px 0 texts outside the window outside a box that scrolls sideways, and no page that scrolls sideways; 0 requests to other hosts. Between them 1 to 3 priorities, 0 or 1 mark, 1 to 12 rows of the Zeitschnitt. The first run found one fault of the check itself (it asked for a number in the title "Seitensprache nicht angegeben", which has none); fixed in the check, not in the page.
- End to end on `npm run dev:local` (the integration test `worker/test/integration/scan-screen-dev.test.ts`, the fixture site): home → form → scan screen → "Bericht öffnen" → `/bericht?id=…`: the heading, the facts, one row per Prüfmaß and one bar per row of the Zeitschnitt of the API's report, the last line, `noindex, nofollow` and `no-referrer` (meta elements, and `X-Robots-Tag` and `Referrer-Policy` of the static assets on `wrangler dev`), 0 requests to other hosts; an unknown id shows "Diesen Bericht finden wir nicht.".

### Numbers against the conditions of the session message (final run, all checks one after the other)

Session message, at both widths:
- The example against the reference with the decided wording (`npm run visual`): report 0.000 % at 1440 px (0 of 2,733,120 pixels) and at 390 px (0 of 1,152,060), the 228 pixels of ": Design und Skripte" of part 1 are gone; against the unchanged reference 0.333 % and 6.570 % (the decided row). Home and scan screen 0.000 % at both widths (0 pixels).
- Motion (`npm run motion`): report 6 of 6 animations, home 25 of 25 (layer switch 6 of 6 transitions), scan screen 44 of 44 without difference; all 64 frames 0 pixels; reduced motion 0 animations.
- The real report page in every state (`npm run check:report`, 30 states, each at 1440 and 390 px, 60 of 60 without a problem): axe-core 4.14.1 0 violations; contrast by pixels where axe could not decide 933 texts, 0 under the required ratio, lowest 5.27:1; Tab in the order of the reference (header, the three actions of the head, the Prüfmaße box at 390 px, the BFSG link, the priorities, the Zeitschnitt box, footer; the way on of a state without a report), every stop with a ring at least 1.44 times the required area at 3:1 and whole in the window; reduced motion 0 animations; with motion the longest 2,350 ms (the last number of the plan); every value equal to the JSON (self-test 5 of 5); at 390 px no text outside the window outside a scroll box, no page that scrolls sideways; `noindex, nofollow` and `no-referrer` in every state; 0 requests to other hosts. The first run at 390 px found a focus ring cut by the bottom edge (the box of the Prüfmaße of one state): `scroll-margin` now also for the boxes with a `tabindex`.
- `npm run a11y` (home, scan screen, example report): axe 0, Tab in the order of the reference: home 14 of 14, scan screen 6 of 6, report 14 of 14 at 1440 px and 16 of 16 at 390 px, every ring whole in the window. `npm run check:scan` 0 problems (every state of the scan screen and the form, with the new rule of the mark).
- The report page is `noindex` (meta element, and `X-Robots-Tag` of the static assets measured on `wrangler dev`), sends no Referer (`no-referrer`).
- Requests to other hosts: 0 in visual, motion, a11y, check:scan, check:report, the 30 reports and the end-to-end path.
- `npm test` 1,473 of 1,473 (1,437 before). `npm run test:integration`: scanner 90 of 90, worker 65 of 65, in the final run; the first run of the session stopped when a vitest worker process crashed (Windows code 0xC0000409) in a scanner file after 87 of 90, the next two runs passed whole. `npm run typecheck` no errors. `npm run build:web` passes: routes `/`, `/_not-found`, `/bericht`, `/pruefung`; no path with "beispiel" and no "roesterei-muster" in `web/out`.
- Leak search over the full list (273 strings: the hosts and names of both site lists, the Impressum values of the earlier sessions and of the reviewers, the reports of B2 part 3, the hosts and Impressum quotes of the 30 reports of step 6, the value of `worker/.dev.vars`): 0 real hits in the 452 tracked files, the added lines of the 18 commits of `b3-report` and their messages; the 35 matches in 21 tracked files are false: a short part of one host name inside one identifier of our code (as before) and a generic label of the commercial register (one line of an Impressum quote, a word of every Impressum) in our own test fixtures. `git ls-files local` is empty.

### How to look at it

- `npm run preview:examples`, then http://127.0.0.1:3000/bericht/beispiel (the example of the reference) and http://127.0.0.1:3000/bericht/beispiel/ + `schnellpruefung`, `blockiert`, `blockiert-schnellpruefung`, `zeitlimit`, `nicht-erreichbar`, `serverfehler`, `keine-website`, `seitenlimit`, `keine-webseite`, `pruefungsfehler`, `nicht-erlaubt`, `fast-leer`, `land`, `keine-bilder`, `manuell`, `zwei-punkte`, `ohne-vorrang`, `ohne-felder`, `banner-spaeter`, `ohne-fremde-server`, `buchstaben`, `gekuerzt`, `laedt`, `nicht-fertig`, `abgebrochen`, `ausgelastet`, `fehlgeschlagen`, `nicht-gefunden`, `fehler`; at full width and at 390 px (the device toolbar of the browser); stop with Ctrl+C.
- The real path: `npm run dev:local`, then http://127.0.0.1:8787/, enter `localhost:8791` and press "Website prüfen", then "Bericht öffnen".
- `npm run check:report` repeats the checks of every state.

## B4 part 1: merge of B3, the lower part of the report with the example JSON (25.11.2026)

Branch `b4-report`, **not merged** (session message: Fedor looks first). `b3-report` is merged into `main` (b5ee7a5, a real merge) after one line of its history was rewritten by the rule of finding 93 and its checks ran again. Session time: about 1 hour 20 minutes (12:06 to about 13:25). No Cloudflare, no deploy, nothing pushed, no listed site opened. One helper (Sonnet), a read-only review of the code of this part: 9 findings, all fixed (02dd8e9 and a3e5d63): the marker "Revisionen" of the production check matched the home page (the first production build of the final run had failed on it too); the note next to the country named a browser for a quick check; the contrast card took its Soll from the Prüfmaß, not from its own text; "vor dem Banner" was said for all requests from the first; "die erste" with one request; Shopware 5 got the Shopware 6 steps; the tabs swallowed Alt+Arrow; `visual` measured the layout after it had hidden cards 2 and 3; a cut Stückliste counted only the rows.

Fedor's answers to the three questions of B3 part 2 and his rules for this part are in `docs/decisions.md` (owner decisions of 25.11.2026, B4 part 1); the technical decisions follow in the technical section.

### Step 1: the history of `b3-report` by the rule of finding 93

- Searched: `docs/progress.md`, the added lines of the 18 commits of the branch and their messages. 0 labels "Site NN" in the added lines and the messages; no line names the identifier. One line (B3 part 1, the rewrite of B2) said how many letters of a host name the identifier holds; it now says "a short part of a host name", like the other lines.
- Rewritten before the merge with `git filter-branch` over `main..b3-report` (the branch was never pushed): only that line changed, in the 12 commits from aa47ec0 on (now da731c9 to c79cb08); the 6 commits before keep their hashes.

### Step 2: the checks of B3 on `b3-report`, then the merge

- `npm run check:report` 0 problems; `npm run check:scan` 0 problems; `npm test` 1,473 of 1,473; `npm run test:integration` scanner 90 of 90, worker 65 of 65; `npm run typecheck` no errors; `npm run build:web` passes without example data; `npm run visual` home, scan screen and report 0.000 % at both widths; `npm run motion` and `npm run a11y` pass (6, 25 and 44 animations without difference; Tab 14, 14 and 16, 6 in the order of the reference; axe 0).
- Leak search over the full list of the last part (273 strings, `local/tools/leak-check-b3-2.ts`): 0 hits in the added lines of the 18 commits and their messages; the 35 matches in 21 tracked files are the same false ones as before. `git ls-files local` is empty.
- The browser build: no Ajv in any chunk, and no `eval`, `new Function` or `Function(` in any chunk a browser runs as a module; the one `Function("return this")` is the last fallback of the polyfill chunk of Next.js, which the pages load with `noModule` (a browser with modules never runs it). Ajv stays in the example build script and a unit test. So the CSP of B5 needs no `unsafe-eval`.
- Merged with `git merge --no-ff` (b5ee7a5). Branch `b4-report` from it. The new code of B4 was written in a scratch worktree while the checks of B3 ran, so nothing new lay in `web/` during them.

### What was done

- Step 4, the note next to the country (Fedor's answer 3): "Aufgerufen aus {Land}" with a second small grey line: "Unser Prüfbrowser läuft in einem Rechenzentrum in der EU und ist eingestellt wie ein Besucher aus Deutschland: deutsche Sprache, Zeitzone Berlin." "in der EU" only for a member state of the EU, the settings only when the report says `de-DE` and `Europe/Berlin`; a draft. `check:report` reads and expects it.
- Step 5, the lower part by bericht.html (`web/components/report/services.tsx`, `finding-cards.tsx`, `fix-tabs.tsx`, `help-block.tsx`, `title-block.tsx`, `stage-d.tsx`; `web/lib/report-detail-view.ts`, `report-detail-texts.ts`, `report-stage-d-texts.ts`):
  - Stückliste: one row per service (position, our name of a known service, the name of an unknown one as a string of the page in `<bdi>`, the small line by category, provider, "Daten gehen an", "vor der Einwilligung", the tag of "Einwilligung"); the copy button without behaviour (part 2).
  - One finding detail per priority (`#fund-1` to `#fund-3`, the targets of the links of "Drei Dinge"; the reference has the first as the pattern): number, title, field; "Was passiert" (Google Fonts with the reference's sentence from the report's values; other third parties and the other findings with drafts); Soll and Ist (third parties as in the reference; the others from the Prüfmaß of the same thing); "Warum das wichtig ist"; "Gefunden im Quelltext" with the addresses of the requests the parser found in the homepage; the "Montageanleitung" with the five system tabs by the WAI-ARIA tabs pattern (roving Tab stop, arrow keys, Home, End, the panel a Tab stop of its own, the detected system selected with "erkannt") where our texts have steps by system (Google Fonts), else the general steps of the drafts without tabs. A part without data or text is left out.
  - The help block: "Hilfe bei der Umsetzung anfragen" leads to `/anfrage` (the lead form of stage C) and carries nothing.
  - The title block (Benennung, Objekt, Datum, Revision, Blatt, Geprüft).
  - "Revisionen" and the "Arbeitsauftrag" (its line and button): a module only the example page imports; the production build fails when one of their texts is in `web/out` (`web/scripts/next.ts`).
  - Every string a text node; the strings of the page in `<bdi>`; templates filled in one pass; no HTML from the report. Only the example page shows the lower part in this part; the real report page keeps its upper part until part 2.
- Step 6: `npm run visual`, `motion` and `a11y` check the whole report (above).

What the lower part of the reference shows that schema v1 does not express:
- The YouTube row of the Stückliste ("erst nach Klick", "wird eingeholt", "Produktvideo"): a service that waits for a click (gap 3) and the use of a service on the page (gap 5). The example has four services, so jsDelivr is position 4 of "4 Dienste gefunden".
- The short names "Google Tag Manager", "Google Analytics 4", "jsDelivr": the report has the names of the rules data ("Google Tag Manager / Google tag (gtag.js)", "Google Analytics", "jsDelivr (incl. BootstrapCDN)"); the version "4" is not measured.
- "Gefunden im Quelltext" with the tag `<link rel="stylesheet" href="…">`: the report has the address of the request (gap 2).
- Stage D, not data: the revision B "offen", "Erneut prüfen", the crossed-out example, the "Arbeitsauftrag" (example only).

### Numbers against the conditions of the session message (final run, all checks one after the other)

- The whole report page of the example against the reference with the decided wording (`npm run visual`): 5.880 % at 1440 px (347,502 of 5,909,760 pixels; the app 82 px shorter) and 4.031 % at 390 px (107,470 of 2,666,040; 8 px shorter): **above the 1 % of the session message**. All of it is the data schema v1 does not hold (above): against the reference that has, besides the decided wording, the data of the example (the Stückliste without the YouTube row, the names of the rules data, the address in "Gefunden im Quelltext") the page differs by 0 pixels at both widths (0 of 5,791,680 and 0 of 2,662,920; also 0 "strict" pixels). Against the unchanged reference 6.034 % and 7.770 %. Home and scan screen 0.000 % at both widths (0 pixels). The cards 2 and 3 are hidden in the app before the comparison (the reference has one card).
- Motion (`npm run motion`): report 6 of 6 animations (the marks of the plan) without difference in target, keyframes, duration, delay, easing and fill, started together; frames of the whole page at 10 moments from 0.3 to 2.5 s against the reference with the data of schema v1: 0 pixels in all 20; home 25 of 25 and scan screen 44 of 44, all 52 frames of the three pages 0 pixels; reduced motion 0 animations. The lower part has no animation; the longest motion of the report ends at 2.35 s, nothing longer than 5 s.
- `npm run a11y` (home, scan screen, example report): axe-core 4.14.1 0 violations at both widths, with reduced motion and after every animation; contrast by pixels where axe could not decide: report 20 texts at 1440 px and 63 at 390 px, 0 under the required ratio, lowest 5.27:1. Keyboard: report 20 of 20 Tab stops at 1440 px and 23 of 23 at 390 px in the order of the reference (with the Tab stops of the WAI-ARIA tabs pattern: the selected tab and the panel), every stop with `:focus-visible`, the ring at least 1.44 times the required area at 3:1 (the link "BFSG-Prüfschema" at 390 px; the panel 1.46), whole in the window right after Tab; the system tabs: ArrowRight, ArrowLeft, Home and End select and focus the tab and the panel follows, Tab goes on to the panel, a click selects. Home 14 of 14, scan screen 6 of 6.
- Requests to other hosts: 0 in visual, motion, a11y, check:report and check:scan.
- At 390 px the page does not scroll sideways; the 55 texts outside the window, measured with all three cards shown, all lie in the four boxes that scroll sideways inside the sheet (Prüfmaße, Zeitschnitt, Stückliste, Revisionen), as in the reference (57 there, with the YouTube row).
- `npm test` 1,497 of 1,497 (1,473 before; 24 new in `web/test/report-detail.test.tsx`, and the note in `web/test/report-states.test.tsx`). `npm run typecheck` no errors. `npm run build:web` passes: routes `/`, `/_not-found`, `/bericht`, `/pruefung`; no path with "beispiel", and none of "roesterei-muster", "Jede neue Prüfung wird eine Revision", "Arbeitsauftrag", "Erneut prüfen", "behoben in Rev." in `web/out` (checked by `web/scripts/next.ts` on every production build). The production bundle: no Ajv in any chunk, 0 `eval`, `new Function` or `Function(` in the 9 module chunks (the `noModule` polyfill chunk apart, as above).
- `npm run check:report` 0 problems (every state at both widths, the note next to the country included), `npm run check:scan` 0 problems. `npm run test:integration`: scanner 90 of 90, worker 65 of 65 (with the end-to-end path of `npm run dev:local` to the report page).
- The final run was repeated twice: the first production build failed on the marker "Revisionen" (the home page has the word; fixed, a3e5d63), and the second run overlapped with a check script that had survived its stop (one worker unit test timed out at 5,053 of 5,000 ms under that load); the run above ran alone, after every process of the earlier runs was ended.
- Leak search over the full list (273 strings) for the commits of `b4-report`: 0 hits in the added lines of its 7 commits before this one and in their messages; the 35 matches in 21 of the 462 tracked files are the same false ones as before. `git ls-files local` is empty.

### How to look at it

- `npm run preview:examples`, then http://127.0.0.1:3000/bericht/beispiel at full width and at 390 px (the device toolbar of the browser), next to `design/reference/bericht.html`; the system tabs with the arrow keys after Tab; stop with Ctrl+C. http://127.0.0.1:3000/bericht/beispiel/land shows the note next to the country (the head only).
- `npm run visual`, `npm run motion`, `npm run a11y` repeat the comparison; images in `local/visual` (`bericht-*-diff.png` with the decided wording, `bericht-*-diff-data.png` with the data schema v1 holds), `local/motion`, `local/a11y`.

## B4 part 2: the lower part for a real id, its states, copying, the actions of the head, printing (25.11.2026)

Branch `b4-report`, **not merged** (session message: Fedor looks at the new states first; the merge is the first step of B5). Session time: about 1 hour 20 minutes (13:52 to about 15:12). No Cloudflare, no deploy, nothing pushed, no listed site opened: the reports of real sites were built again from saved captures. One helper (Sonnet), a read-only review of the code of this part: 9 findings, all fixed (e4b2a3d): a priority to check by hand (the Impressum link not found) became a task of the help text; the copied list repeated the brand after a short name with brackets ("Mouseflow (Ladeskript) (Mouseflow)") and kept U+2028; `check:report` could not see an empty card (the box of the Montageanleitung always had text), took a request address with "security-" for a text id, did not ask that the status regions were there before the click, read no background image of the printed page; `npm run visual` did not fail above 1 %; the rule for an element larger than the window held for wide elements too.

Fedor's answers to the three questions of B4 part 1 and his rules for this part are in `docs/decisions.md` (owner decisions of 25.11.2026, B4 part 2, with the five places put into the reference for the measure of answer 1); the technical decisions follow in the technical section.

### Step 1: short names of the services (Fedor's answer 2)

- `shortName` for each of the 95 services of `scanner/data/third-party-services.json` (drafts, `docs/content-drafts.md`, "Session B4 part 2"): the brand as the brand writes it, without a version the scan does not tell; a German word in brackets only where one brand has several rules. At most 40 characters and unique (`parseRulesFile`). The analyzer gives a known service its short name, so the report, the scan screen and the copied list carry it; `name` stays the descriptive name of `docs/rules-sources.md`. 68 of the 95 differ from `name`.
- The reports of all 292 saved captures built again without a visit (before and after, every change assigned to its cause by a local tool): 154 changed, 138 unchanged; every change is a name of a known service, from its name in the rules data to its short name: 345 rows of `services[].name` and 254 `findings[].params.service`, 22 different names (most often "Google Tag Manager / Google tag (gtag.js)" to "Google Tag Manager", 132 times); 0 unexplained; our validator and Ajv 292 of 292.
- The example JSON carries the short names; the reference gets 5 places of the data of schema v1 instead of 7 ("Google Analytics" for "Google Analytics 4" is the only name left).

### Steps 2 to 5: what was built

- The real report page (`/bericht?id=…`) shows the lower part from the data of the API, like the example and every state: for a report whose homepage was checked the Stückliste, one finding detail per priority and the help block; the title block at the foot of every sheet (a report without a checked homepage keeps its head and the note).
- The country of the visit next to every finding about data sent before consent (Fedor, 21.11.2026; findings of kind `finding`, not hints): "Land des Aufrufs: {Land}", the small grey line under "vor der Einwilligung" of its row and under "Was passiert" of its card. "Gefunden im Quelltext" only for a request the parser found in the homepage itself, with its address.
- A card is never empty: a finding without a fix text gets the box with "Für diesen Punkt haben wir noch keine Anleitung."; one without any text says that the scan found the point. The help block names what the priorities are about (the reference's text for the example), without a task for a point to check by hand; a report without priorities gets a text of its own. New texts are drafts (`docs/content-drafts.md`, "Session B4 part 2").
- Three new states without design, built only from elements of the reference: `dienste-markierungen` (every tag of "Einwilligung": fehlt, bitte manuell prüfen, keine Antwort, Graubereich, nicht nötig; a long name), `fund-ohne-systeme` (general steps, no tabs), `fund-ohne-anleitung` (no fix text yet, with the country). The other listed states already exist and now show their lower part: `gekuerzt` (80 of 85 services), `ohne-vorrang` (no finding at all), `schnellpruefung` (no services, no accessibility), `fast-leer`.
- Copying and the head: "Liste für die Datenschutzerklärung kopieren" puts the list on the clipboard in the form of the reference's script and then says "Liste kopiert"; "Link kopieren" copies the address of the report and says "Link kopiert"; "Als PDF speichern" opens the print dialog; "An Entwickler weitergeben" is stage D (the example only, a marker of the production check). Each copy has a status region from the first paint, so a screen reader hears the result on every click.
- Print styles of the whole report: the sheet on white, without the blueprint background, header, navigation, footer, shadow and buttons; of the system tabs only the selected one, as the label of its steps; nothing cut at the side; the drawings in their final state.

### Step 6: the report page on the reports of the 30 latest saved captures (no site visited)

- The 30 captures saved last (all `complete`, local runs without a visit country), built again with the short names: 60 of 60 without a problem at 1440 and 390 px (every value equal to the JSON, the lower part too; axe 0; 0 texts outside the window at 390 px outside a scroll box; 0 requests to other hosts). Between them 0 to 9 services per report, 1 to 3 priorities, 71 finding details, 3 of them with system tabs.

### Numbers against the conditions of the session message (final run, all checks one after the other, 14:43 to 15:09, `npm test` again after it)

- The whole report page of the example against the reference into which the data schema v1 holds is put (the measure of Fedor's answer 1, the 5 places in `docs/decisions.md`; `npm run visual`): **0.000 % at 1440 px (0 of 5,791,680 pixels) and at 390 px (0 of 2,641,080), 0 strict pixels**. The strict number next to it, against the reference with the decided wording only: 5.847 % (345,534 of 5,909,760; the app 82 px shorter) and 6.126 % (163,329 of 2,666,040; 64 px shorter: the short names fit on one line, so everything under the Stückliste moves up by more than in part 1, where it was 4.031 % with 8 px); against the unchanged reference 6.001 % and 6.567 %. Home and scan screen 0.000 % at both widths (0 pixels). `npm run visual` now fails above 1 %.
- Motion (`npm run motion`): report 6 of 6 animations without difference, its frames at 10 moments against the reference with the data of schema v1 0 pixels at both widths; home 25 of 25, scan screen 44 of 44, every frame 0 pixels; reduced motion 0 animations. The longest motion of the report ends at 2.35 s.
- `npm run a11y` (home, scan screen, example report): axe-core 4.14.1 0 violations; Tab in the order of the reference: report 20 of 20 at 1440 px and 23 of 23 at 390 px (with the Tab stops of the WAI-ARIA tabs pattern), home 14 of 14, scan screen 6 of 6; every ring whole in the window; the system tabs by ArrowRight, ArrowLeft, Home, End, Tab to the panel and a click; contrast by pixels lowest 5.27:1.
- The real report page in every state (`npm run check:report`, 33 states at each width, 66 of 66 without a problem): axe 0; contrast by pixels where axe could not decide 1,404 texts, 0 under the required ratio, lowest 5.27:1; Tab in the order of the reference with the new stops (7 to 19 stops), the tab and the panel of every card in pairs, the weakest ring 1.44 times the required area at 3:1, every ring whole in the window except the box of the cut Stückliste at 390 px (9,657 px high, measured along its edges in the window, `docs/decisions.md`); the system tabs of every card by keyboard; reduced motion 0 animations; with motion the longest 2,350 ms; every value equal to the JSON, the lower part too (self-test: 9 changed values, all 9 seen); "Als PDF speichern" calls the print dialog; "Link kopieren" and the copy button put the address and the list on the clipboard, change their label and say it in a status region that was empty before; at 390 px no text outside the window outside a scroll box; noindex and no-referrer.
- Printing with the print media emulated (`check:report`, 66 of 66): 0 visible buttons but the selected tab, 0 header, navigation or footer, a white page without background image, 0 dark backgrounds behind text, axe 0, contrast by pixels 309 texts, lowest 5.27:1; screenshots `local/report-check/print-<state>-<width>.png`. The example with the print media at 794 px (the width of A4) looked at by eye: the page 794 px wide, nothing cut at the side.
- The report page on the reports of the 30 latest saved captures (`check:report --reports`): 60 of 60 without a problem: every value equal to the JSON, axe 0, 0 texts outside the window at 390 px.
- Requests to other hosts: 0 in visual, motion, a11y, check:report (states and saved reports) and check:scan.
- `npm test` 1,509 of 1,509 (1,497 before), in the third run: the first run of the final run overlapped with two runs of the leak search (two unrelated tests timed out at 5,000 ms), the second, alone, had one timeout (the parser test "a long table row": 5.8 s in the full suite, 0.5 s on its own, twice); nothing in the parser changed in this session. `npm run test:integration`: scanner 90 of 90, worker 65 of 65 (the end-to-end path reads the lower part now; the early run of the session failed there, because the test counted every table row as a Prüfmaß). `npm run typecheck` no errors. `npm run build:web` passes: no path with "beispiel", and none of "roesterei-muster", "Jede neue Prüfung wird eine Revision", "Arbeitsauftrag", "Erneut prüfen", "behoben in Rev.", "An Entwickler weitergeben" in `web/out`. `npm run check:scan` 0 problems.
- Leak search over the full list (273 strings) for `main..HEAD`: 0 hits in the added lines of the 14 commits of `b4-report` before this one and in their messages; the 35 matches in 21 of the 463 tracked files are the same false ones as before; no label "Site NN" in any message. `git ls-files local` is empty.

### How to look at it

- `npm run preview:examples`, then at full width and at 390 px (the device toolbar of the browser): http://127.0.0.1:3000/bericht/beispiel (the whole example); the new states http://127.0.0.1:3000/bericht/beispiel/dienste-markierungen, `/fund-ohne-systeme`, `/fund-ohne-anleitung`; the lower part of the earlier states `/gekuerzt`, `/ohne-vorrang`, `/schnellpruefung`, `/fast-leer`, `/land` (the country next to the findings), `/zwei-punkte`, `/ohne-felder`, `/banner-spaeter`; the print preview of the browser (Ctrl+P) on any of them; stop with Ctrl+C.
- `npm run check:report` repeats the checks of every state (`-- --only <state,…>` for single states); the print screenshots are `local/report-check/print-<state>-<width>.png`.

## Next

- Fedor: look at the new states and the lower part of the real page (`npm run preview:examples`, the addresses above; the real path with `npm run dev:local`), the print preview, and the drafts in `docs/content-drafts.md` ("Session B4 part 2": the 95 short names and the texts of the lower part); answer the questions of the report of B4 part 2.
- B5, first step: the merge of `b4-report` after the rule of finding 93 is checked on its history and the checks of B4 run again; then the BFSG page and the quality gate.
- A session of its own after B4 (Fedor's answer 3): the fix texts (31 services and 10 other findings for five systems, the texts of the security headers; `docs/content-drafts.md`, "Session B4 part 1").
- Fedor: push `main` (the merges of B1, B2 and B3).
- Fedor, before the launch (stage C): create the real D1 database (all five migrations) and put its id into both configs, set `RATE_LIMIT_SECRET` on the scan Worker; deploy the scan Worker first, then the API Worker. The measurements before the launch are in `docs/backlog.md`.
