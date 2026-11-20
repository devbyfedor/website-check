# Decisions

## Owner decisions

Copied from `docs/brief.md` (brief v1, approved on 19.11.2026), with their dates.

- 23.10.2026: project paused. 19.11.2026: resumed.
- Since October 2026: zero budget, free tiers only.
- 19.11.2026: no separate prototype. Build the real product, starting with the scan core, and measure it on Cloudflare early.
- 19.11.2026: name Website-Check DE. Folder, repository and address: `website-check`.
- 19.11.2026: the repository is public from day one. Results of scans of real third-party websites never go into the repository.
- 19.11.2026: the Impressum of our site will carry Fedor's real name and postal address (stage C).
- 19.11.2026: Fedor answers leads only in writing, by e-mail. The lead form says that the answer comes by e-mail.
- 19.11.2026: Impressum fields are found with templates (regular expressions) first. The Claude API is added later only if the templates miss often on live sites.
- 19.11.2026: design variant "Bauplan" (blueprint) with the improvements is approved. The reference in `design/` is the source of truth.
- No date given in the brief (part of brief v1, 19.11.2026): explanations of findings are written in advance and stored in the repository. No AI generates findings or legal explanations at runtime.

## Technical decisions

- 20.11.2026: the brief arrived as `docs/BRIEF.md` and is committed as `docs/brief.md`, because the brief and all instructions use that name and GitHub paths are case-sensitive.
- 20.11.2026: `.gitattributes` forces LF line endings, so Git on Windows (system `core.autocrlf=true`) never rewrites the read-only files in `design/`.
- 20.11.2026: Node 24.15.0 is pinned in `.nvmrc` and `.node-version`; `engines` allows `>=24.15.0 <25` and `.npmrc` sets `engine-strict`, so a wrong Node major fails at install. Node 24 is the installed LTS line.
- 20.11.2026: dependencies are saved with exact versions (`save-exact`) and `package-lock.json` is committed, so every session installs the same versions.
- 20.11.2026: TypeScript 6.0.3 (the last JavaScript-based release) instead of 7.0 (the native port): stage B uses Next.js and other tools that load the TypeScript JavaScript API; revisit when they support 7.
- 20.11.2026: no build step for TypeScript. Node 24 runs `.ts` files directly (type stripping), so the code uses only erasable syntax (`erasableSyntaxOnly`) and explicit `.ts` import extensions; Vitest and later wrangler read the same files.
- 20.11.2026: Vitest 5 with one project per workspace; `npm test` runs only unit tests without browser or network.
- 20.11.2026: registrable domains come from `tldts` with the private part of the Public Suffix List, as browsers do: every `*.myshopify.com` shop is its own site, and each `*.googleapis.com` host is its own site. `tldts` ships the list and runs in Node and in Workers.
- 20.11.2026: first party means the registrable domains of the final URL and of every earlier main document (HTTP redirects and client-side redirects), because the site owner controls those redirects.
- 20.11.2026: every third-party request belongs to exactly one service. Inside a third-party iframe, the outermost third-party iframe owns it; a request triggered by a script or stylesheet of an embedded product (map, video, chat, reviews, analytics, captcha, …; not fonts, CDNs, platforms, consent tools or tag managers) belongs to that product; a script of an unknown third party also owns what it triggers. Reason: Google Fonts loaded by the Google Maps script or inside a YouTube iframe does not mean that the site embeds Google Fonts; the product's entry lists such requests under "includes". This avoids false positives.
- 20.11.2026: a service is a finding only if at least one of its requests got a response. If all requests failed (for example a domain that no longer exists), it is shown as a hint.
- 20.11.2026: unknown third-party hosts are grouped by registrable domain and shown as grey-zone hints ("bitte manuell prüfen"), never as violations.
- 20.11.2026: the local adapter reads request initiators from the Chrome DevTools Protocol (best effort). The analyzer also works without them, which matters for the Cloudflare adapter in A2.
- 20.11.2026: the network counts as quiet when the load event has fired, no request is open and nothing started or finished for 1.5 s; WebSocket and EventSource connections do not count. Limits from the brief: 15 s waiting, 20 s per page.
- 20.11.2026: the local adapter uses the full Chromium of Playwright in the new headless mode (`channel: 'chromium'`), not the reduced headless shell, and a fresh browser context per site with service workers blocked, so every visit is a first visit without stored consent.
- 20.11.2026: the consent banner probe is one plain JavaScript string injected before any page script, so the Cloudflare adapter can reuse it unchanged. It checks known selectors every 100 ms and a text heuristic every 500 ms, and it only reads the page.
- 20.11.2026: rules data are JSON files in `scanner/data/`, validated when they are loaded; unit tests check that every cited source exists in `docs/rules-sources.md`.
- 20.11.2026: `npm test` runs only unit tests. The Playwright adapter has its own integration test (`npm run test:integration`) against a local fixture server; Chromium maps the fixture host names to 127.0.0.1, so no request leaves the machine.
- 20.11.2026: the local adapter sends the user agent of a normal desktop Chrome of the same version, never "HeadlessChrome". Reason (rules research, vendor code checked): Real Cookie Banner and Didomi accept all services for user agents containing "headless" by default, Usercentrics does so with its bot detection on, and Cookie Notice hides its banner and its blocking script. With a headless user agent the scan would see trackers that real visitors do not see before consent, which would be false positives. None of the 18 consent tools checked reads `navigator.webdriver`, so the adapter does not touch it. The scan sends no extra headers (no From, no Global Privacy Control).
- 20.11.2026: at the end of a visit the adapter reads, best effort, what Cookiebot (`Cookiebot.consent`) and Usercentrics (`UC_UI.areAllConsentsAccepted()`) report about consent (`consentBanner.signals`). The scan never consents, so a reported consent means automatic consent; the manual check uses it, the analyzer does not yet.
- 20.11.2026: Jimdo's built-in cookie banner has no documented element id; it is found by the generic text heuristic of the banner probe, not by a selector.
- 20.11.2026: rules data from a research run with adversarial verification (12 helpers): 95 services with 224 host patterns, 132 cited sources, every source opened twice, none rejected. Services whose loader can be used in a documented consent-respecting way (Klaviyo loader, HubSpot, Matomo Cloud, Mouseflow, etracker, Jetpack Stats, Tidio, Userlike) and all review widgets are grey-zone, because a request alone does not prove a violation. The catch-all entry for `www.google.com` and `www.gstatic.com` was dropped; such requests are reported as an unknown third party.
- 20.11.2026: `.gitignore` ignores `/local/` (the folder in the repository root) instead of `local/`, because the pattern without a leading slash also hid the code folder `scanner/src/local/`.
- 20.11.2026 (after the manual check, replaces the part of the attribution rule about products and unknown scripts): an embedded product owns only the requests to its own provider that it triggers in the page (Google Fonts loaded by the Google Maps script belong to Google Maps). Google Fonts loaded by an app or script of another provider stay a Google Fonts finding, with the initiator in the evidence, because the site installed and configured that app (the design reference says "Google Fonts kommen meist aus einer App"). Requests inside a third-party iframe still belong to that iframe's service. Found on a test site where a newsletter app injects its form fonts from Google.
