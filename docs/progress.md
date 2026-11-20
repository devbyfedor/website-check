# Progress

## Current state

Stage A, session A1 (project setup and the first check, locally) is done on branch `a1-setup` and NOT merged into `main`: the test set contains only 3 Google Fonts findings, while the merge condition asks for a manual check of 5 (details below). Every other point of the merge condition holds. Fedor decides whether A1 is merged as it is.

## A1: project setup and the first check, locally (20.11.2026)

- Step 1: repository initialised. First commit on `main` contains only `design/` and `docs/brief.md`.
- Step 2: `.gitignore`, `.gitattributes`, `CLAUDE.md`, `docs/progress.md`, `docs/decisions.md`, `docs/backlog.md`.
- Step 3: npm workspaces `scanner/` and `worker/`, TypeScript 6.0.3 strict, Vitest 5.1.1, Node 24.15.0 pinned.
- Step 4: rules data for third-party services: 95 services with 224 host patterns (precedent 1, consent-required 17, usually-consent 14, grey-zone 47, not-flagged 16) and 132 sources in `docs/rules-sources.md`. A research pass with 12 helpers opened every source twice (research plus an independent attempt to refute it); none was rejected, uncertain classes went to grey-zone. Consent tool data: 21 tools with banner selectors.
- Steps 5 to 7: local Playwright capture adapter (Chromium, de-DE, Europe/Berlin, 1440 x 900, normal Chrome user agent, no interaction, network quiet or at most 15 s, banner probe), third-party analyzer, local runner (`npm run scan:local`) and explain tool (`npm run explain`).
- Step 8: 30 test sites in `local/sites.txt` (git-ignored): 12 online shops (4 Shopify, 4 WooCommerce, 4 Shopware), 12 small service businesses (3 craftsmen, 3 restaurants or inns, 3 practices, 3 agencies; 8 on WordPress, 4 on other systems), 6 sites on Wix (3) and Jimdo (3). All 30 are businesses in Bavaria. Research helpers proposed 62 candidates, each with one homepage fetch to confirm the system; a second helper checked each candidate and rejected 8 (a homepage with injected gambling spam, a chain with five stores, a shop that is not independent, a site without a shop, an owner that could not be verified, a hobby offer, an outdated Jimdo copy of another site, a second site on the same Jimdo free domain).

### Step 9: local run over the 30 sites

One run on 20.11.2026, Chromium 159, from Germany, homepage only, one visit per site. Aggregated numbers, anonymous labels only.

- Captures: 30 of 30, no failures, no retries.
- Capture time per page: median 5.6 s, max 15.1 s. 22 pages stopped on a quiet network, 8 at the 15 s limit.
- Requests per page: median 74, max 471. Third-party requests per page: median 17, max 308.
- Consent banner seen on 18 of 30 sites, median 2.0 s after the start (shopware 3, generic heuristic 5, borlabs-cookie 2, complianz 2, usercentrics 2, wix 2, cookieyes 1, shopify 1). The manual check found at least 5 visible banners that were missed: three banners of two Shopify consent apps that draw in a shadow root (Pandectes twice, Consentmo once), one Cookie Notice bar lower than the heuristic's minimum height, and one Borlabs box that appeared only after the capture had ended. Fixes are in `docs/backlog.md`. Banner timing never decides a finding.
- Sites with at least one finding: 10. With hints only: 14. With neither: 6.
- Sites per risk class: precedent 3, consent-required 8, usually-consent 3, grey-zone hints 22, not-flagged 9. Unknown third parties on 18 sites.
- Most frequent services (sites): Google Tag Manager 7, Google Analytics 5, Shopify CDN 4, Shopify telemetry 4, Google Ads 3, Google Fonts 3, reCAPTCHA 3, Jimdo assets 3, Wix media 3, Wix platform 3, Meta Pixel 2, Pinterest Tag 2, Usercentrics 2, WordPress emoji 2, YouTube (privacy mode) 2.
- Consent signals: on both Usercentrics sites the tool reported no consent at the end of the visit, so it did not consent on its own.

### Step 9: manual check of Google Fonts

Done by hand in the saved captures (`npm run explain`, saved HTML, screenshots) and again by 7 independent reviewers who tried to refute each result. No site was visited again.

- Only 3 of the 30 sites have a Google Fonts finding: Site 03, Site 05, Site 21. All 3 are true positives, 0 false positives. In all three the requests were made in the top-level document, got a response, and came from the site itself: form fonts of a newsletter app that the shop installed (style element injected at runtime), the font list of a newsletter plugin, and the site's own WebFont configuration. On all three a consent banner was still open in the final screenshot, so no consent had been given.
- On 4 more sites (Site 11, Site 16, Site 22, Site 30) Google Fonts were loaded only inside YouTube (privacy mode) and reCAPTCHA iframes. The analyzer attributes them to those embeds and does not report Google Fonts for the site; the check confirmed that these sites do not load Google Fonts themselves: 0 wrong attributions.
- Change after the check: an embedded product now owns only requests to its own provider (Google Maps loading Google Fonts). Google Fonts loaded by an app of another provider stay a Google Fonts finding, with the initiator in the evidence. Re-analysis of the saved captures (`npm run scan:local -- --reanalyze`, no new visits) gives the same numbers as above.

### Merge condition A1

- `npm test` passes completely: 117 of 117 unit tests. The Playwright integration test (`npm run test:integration`): 10 of 10. `npm run typecheck`: no errors.
- At least 27 of 30 sites give a capture: 30 of 30, no failures.
- 0 false positives in the manual check of 5 sites: 0 false positives, but only 3 sites of the test set have a Google Fonts finding, so 5 findings could not be checked. 3 findings plus 4 related cases were checked. Not met as written.
- `git ls-files local` is empty: yes.

Result: not merged. The test set was not changed to reach 5 findings, because choosing sites by their findings would bias the set.

## Next

- Fedor: decide whether A1 may be merged with 3 checked findings plus 4 related checks, or whether the check needs more Google Fonts sites.
- A2: measurement on Cloudflare, as in the brief. Also from the backlog: banner probe fixes for shadow roots, Cookie Notice and late banners; check where Browser Run starts its browsers (consent tools consent by location).
