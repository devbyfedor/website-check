# Progress

## Current state

Stage A, session A1 is merged into `main`. Session A2 (measurement on Cloudflare) runs on branch `a2-cloudflare` in three parts (Fedor's decisions of 21.11.2026):
- Part 1 (done): the Cloudflare capture adapter in `worker/` with both strategies, and a check on three sites of whether consent tools behave the same with the Cloudflare browser as with the local run (banner, third-party requests before consent, browser location, Worker CPU and wall time).
- Part 2 (this session): the capture moves into a Durable Object in the EU jurisdiction; the Worker only checks the token and passes the job on. The scanner recognises blocked pages (a web host's check page such as "Einen Moment bitte") and gives no findings for them. Check on Cloudflare: browser location from the Durable Object, the three sites of part 1 with both strategies, Site 06 recognised as blocked, CPU of the Worker and of the Durable Object.
- Part 3 (next session): banner probe fixes, the measurement on 12 sites, `docs/measurements/a2.md` with the plan recommendation, the merge into `main`, and deleting the lab Worker.

Why three parts (Fedor, 21.11.2026): "Cloudflare did not stop any request" in part 1 is no proof. By the Workers limits page the free plan has only an allowance for occasional overruns of the 10 ms CPU limit; with constant overruns requests fail with error 1102. Part 1 measured 13 to 183 ms per page, so a capture in a plain Worker on the free plan does not fit. A Durable Object has 30 seconds of CPU per request by the limits table and is available on the free plan with SQLite storage only; part 2 checks whether the capture fits there before the 12-site measurement is planned on top of it.

## A1: project setup and the first check, locally (20.11.2026)

- Step 1: repository initialised. First commit on `main` contains only `design/` and `docs/brief.md`.
- Step 2: `.gitignore`, `.gitattributes`, `CLAUDE.md`, `docs/progress.md`, `docs/decisions.md`, `docs/backlog.md`.
- Step 3: npm workspaces `scanner/` and `worker/`, TypeScript 6.0.3 strict, Vitest 5.1.1, Node 24.15.0 pinned.
- Step 4: rules data for third-party services: 95 services with 224 host patterns (precedent 1, consent-required 17, usually-consent 14, grey-zone 47, not-flagged 16) and 132 sources in `docs/rules-sources.md`. A research pass with 12 helpers opened every source twice (research plus an independent attempt to refute it); none was rejected, uncertain classes went to grey-zone. Consent tool data: 21 tools with banner selectors.
- Steps 5 to 7: local Playwright capture adapter (Chromium, de-DE, Europe/Berlin, 1440 x 900, normal Chrome user agent, no interaction, network quiet or at most 15 s, banner probe), third-party analyzer, local runner (`npm run scan:local`) and explain tool (`npm run explain`).
- Step 8: 30 test sites in `local/sites.txt` (git-ignored): 12 online shops (4 Shopify, 4 WooCommerce, 4 Shopware), 12 small service businesses (3 craftsmen, 3 restaurants or inns, 3 practices, 3 agencies; 8 on WordPress, 4 on other systems), 6 sites on Wix (3) and Jimdo (3). All 30 are businesses in Bavaria. Research helpers proposed 62 candidates, each with one homepage fetch to confirm the system; a second helper checked each candidate and rejected 8 (a homepage with injected gambling spam, a chain with five stores, a shop that is not independent, a site without a shop, an owner that could not be verified, a hobby offer, an outdated Jimdo copy of another site, a second site on the same Jimdo free domain).
- Change of the test set (Fedor's decision, 20.11.2026): the first run had only 3 Google Fonts findings, the merge condition needs 5 checked findings. Two sites were therefore replaced on purpose by sites of the same group that link a Google Fonts stylesheet: one Shopify shop (Site 04, a reserve candidate from the first research) and one craft business (Site 15, from a second search: 48 homepages fetched once each, 6 candidates, all confirmed by a second reviewer). The replaced sites were the last ones of their group without any Google Fonts evidence. The mix stays 12 / 12 / 6, all in Bavaria. Because these two sites were chosen for Google Fonts, the share of sites with Google Fonts in this set (5 of 30) is not representative.

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

- 5 sites have a Google Fonts finding: Site 03, Site 04, Site 05, Site 15, Site 21. All 5 are true positives, 0 false positives. In all five the requests were made in the top-level document, got a response, and came from the site itself: form fonts of a newsletter app the shop installed (style element injected at runtime), the custom-fonts link of a Shopify theme, the font list of a newsletter plugin, the font link of a site builder page, and the site's own WebFont configuration. On all five a consent banner was still open in the final screenshot, so no consent had been given.
- Google Fonts loaded inside Google's own embeds are attributed to those embeds and not reported as the site's Google Fonts: on 4 sites (Site 11, Site 16, Site 22, Site 30) only inside YouTube (privacy mode) and reCAPTCHA iframes, and on Site 15 three more requests inside the Google Maps and reCAPTCHA iframes next to the site's own Google Fonts. Checked: 0 wrong attributions.
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
- Sites: three sites with three different consent tools where the local run sees the banner: Site 10 (Usercentrics, Shopware), Site 04 (built-in Shopify banner), Site 14 (Borlabs Cookie, WordPress). Each with both strategies, then at once locally.
- Site 06 (CookieYes, WooCommerce) does not let the Cloudflare browser in: its web host answers with a bot check page ("Einen Moment bitte …", HTTP 200) and the check did not pass; locally the site loads normally. It was replaced by Site 14 in a second, short browser session. Our classifier counted the check page as a captured page (gap, see backlog).
- Banner: seen on Cloudflare in 6 of 6 captures of the three sites, with the same tool as locally. It became visible earlier than locally (0.7 to 1.7 s on Cloudflare, 1.4 to 2.1 s locally). Usercentrics loaded the same German GDPR settings as locally and reported no consent at the end (`allAccepted: false`) on Cloudflare too.
- Third-party requests before consent: the set of third-party hosts is the same as locally in 6 of 6 captures (0 hosts only on Cloudflare, 0 only locally). Strategy (b) has exactly the local number of third-party requests (60, 33, 0). Strategy (a) has more on two sites, checked one by one: Site 10 one more, Site 04 three more. All of them are CORS preflight requests (`OPTIONS`) to the same hosts right before requests that the local run has too (Usercentrics consent API, Shopify telemetry). Puppeteer reports preflights as their own requests, Playwright does not: a difference of the adapters, not of the sites. Site 14 has 11 more first-party entries in (a), all `data:` images and one SVG fragment that Playwright does not report.
- Findings: strategy (a) has the same findings as locally on all three sites. Strategy (b) has one finding less on Site 10 (Google Tag Manager becomes a hint), because the page cannot see the HTTP status of cross-origin resources.
- Completeness (requests by host and path, compared with the local capture made right after): (a) 97.9 %, 99.7 %, 100 %; (b) 97.9 %, 99.0 %, 100 % (Site 10, Site 04, Site 14). Strategy (b) misses requests inside iframes and requests still open at the end.
- Worker CPU time per page (from `wrangler tail`): (a) 93 ms, 183 ms, 34 ms; (b) 21 ms, 20 ms, 13 ms (Site 10, Site 04, Site 14; on the blocked check page of Site 06 14 ms and 13 ms). Opening the browser 8 and 5 ms, trace page 28 and 16 ms, closing 3 and 2 ms. No capture stayed within the 10 ms of the free plan, also not strategy (b), but Cloudflare did not stop any request (every outcome `ok`, no `exceededCpu`). Even the blocked page with 2 requests costs 13 ms in (b), so most of (b) is a fixed cost of connecting and preparing the tab.
- Worker wall time per page: (a) 3.4 s, 6.8 s, 3.8 s; (b) 4.5 s, 8.3 s, 4.3 s. Network events handled by the Worker in (a): 429, 918, 249; in (b) 2 to 4 events plus 11 to 26 in-page polls.
- Other: Site 04 had 5 findings in the A1 run on 20.11.2026 (Google Fonts, Google Tag Manager, Google Ads, Google Analytics); on 21.11.2026 it has none, locally and on Cloudflare alike. The other sites match their A1 captures and the integration test passes, so the site itself changed. Site 04 was one of the 5 checked Google Fonts sites of A1.

Answer to the main question of part 1: on the three sites that let it in, the Cloudflare browser saw the same banners and the same third-party hosts before consent as the local run from Germany, although it runs in the Netherlands. No site showed trackers that run only for the Cloudflare browser. One of four sites blocks the Cloudflare browser entirely.

## Next

- A2 part 2, as Fedor planned: banner probe fixes (shadow roots, Cookie Notice, late banners), the measurement on 12 sites with both strategies, `docs/measurements/a2.md` with the plan recommendation (A, B or C) with numbers, the merge into `main`, and deleting the lab Worker (`npx wrangler delete -c worker/wrangler.lab.jsonc`). From part 1, in `docs/backlog.md`: blocked pages with HTTP 200, preflights and `data:` requests in strategy (a), the hidden status in strategy (b), the browser location (Netherlands), and where the fixed CPU cost of about 13 ms comes from.
