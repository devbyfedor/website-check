# Backlog

Postponed work. Each item names the session that should pick it up, or "later" when no session is planned yet.

- A2: Cloudflare capture adapter, `wrangler` and the Browser Run binding in `worker/` (A1 creates only the workspace skeleton). Reuse `buildBannerProbeScript` unchanged. Check how many requests keep an initiator or a frame there, because the attribution of embedded products depends on them.
- A3: accessibility (axe-core) and security checks; the capture already keeps the main document headers and the redirect chain.
- A4: Impressum and Datenschutz links, Impressum fields, system detection. The capture already keeps page text and links.
- Later: scripts that some sites delay until the first user interaction (for example "delay JavaScript" in caching plugins) never run in our scan, because the scan never interacts. Real visitors may still load them before consent. These are false negatives, not false positives; document them in the "So prüfen wir" page (stage C).
- Later: `<link rel="preconnect">` opens connections without a request; these are not recorded. Cookies set before consent are not recorded yet either.
- Later: review the rules data regularly (hosts change, new court rulings and DSK guidance).
- A2: consent tools also consent automatically by location (Cookiebot gives 'implied' consent outside its configured regions, Usercentrics can accept all outside the EU, the Shopify banner shows only in configured regions). Scans must run from a German or EU address: check where Cloudflare Browser Run starts its browsers and record `consentBanner.signals` there.
- A4 or later: use `consentBanner.signals` in the analyzer: if a consent tool reports consent although the scan never consented, mark tracker findings of that capture as "bitte manuell prüfen". Extend the signals (TCF API, consentmanager, Didomi).
- A4: apply `not-flagged` for platform hosts (Shopify CDN, Wix media) only when system detection confirms that the site runs on that platform; otherwise grey-zone.
- Later: chat widgets (Tidio, Userlike) could become usually-consent when the capture records cookie or storage writes by them before consent; Google Consent Mode pings (`gcs=G100`) and Microsoft UET `asc=denied` could get a separate explanation text (they are findings today).
- Later: the rules research hit the shared web-search limit; a second pass could add Piwik PRO, Mapp/Webtrekk, econda, Adobe Analytics, Tealium, Segment, CleverReach, Mailchimp and a German source on reCAPTCHA.
