# Report schema v1 and the design reference

Session A5 part 2 (23.11.2026). The report JSON has a versioned schema: `scanner/schema/report.v1.schema.json` (JSON Schema 2020-12, the subset that `scanner/src/report/validate.ts` implements; a unit test compares the validator with Ajv). TypeScript types: `scanner/src/report/types.ts`. Builder: `buildReport` in `scanner/src/report/build.ts`. Stage B renders the report page from this JSON.

The report holds facts, states, text ids and their parameters, never finished German sentences. Texts live in the repository (`docs/content-drafts.md`), so nothing is written at runtime. Ids of texts that do not exist yet are listed at the end.

## States

`state` is one of:

- `complete`: the full check with the browser. Its `notice` is null, with one exception (session fix-a1): `report-page-almost-empty` when the page showed almost nothing (at most 1 500 characters of text, 3 links and 15 requests) and linked to no Impressum and no Datenschutzerklärung. Such a page may be a page of bot protection that no rule names, so the report claims nothing about the site (sessions fix-a1 and fix-a2): it has no item of the kind `finding` or `hint`, no risk and empty `priorities`; the items `manual` and `not-checked` stay, among them the missing Impressum link as `legal-impressum-no-link-empty-page`. Every Prüfmaß that was checked is `manual` with `actual` null. `services` lists what was seen, with `consent: manual` instead of `missing`, `severity: hint` instead of `finding` and `findingId` null. The block `security` is null (no measured state of HTTPS and the headers); `legal` stays. The quick check of such a page keeps its own notice with the parameter `pageAlmostEmpty: true` and follows the same rules.
- `quick`: the daily browser limit was reached and only the quick check without a browser ran (part 3). `notice.textId` is `report-quick-incomplete` ("Die vollständige Prüfung ist morgen wieder möglich."); the sections that need the browser (third-party services, accessibility) are `not-checked` with the reason `quick-check`.
- `blocked`: the site refused the scan (check page, bot protection). No findings, no Prüfmaße, notice `report-blocked`.
- `not-allowed`: refused by the SSRF protection (`failure.reason` `not-allowed`, notice `report-not-allowed` with the rule as `rejection`). No findings.
- `failed`: the homepage did not load (timeout, unreachable, HTTP error), or the capture was cut off after it had answered (the hard limit of a page, a crashed or closed tab; session fix-a1). No findings, notice `report-failed`. A browser lost during a capture gives no report at all: the scan ends as an error.

`sections` says for each part (third-party, accessibility, security, mandatory information, system) whether it was checked and why not (`quick-check`, `page-not-loaded`, `page-not-read` when the page loaded but its text and links could not be read, or the analyzer's reason). A check that did not run is never shown as "keine Funde".

`findings[].beforeConsent` is true only when a request of the service got an answer: then data certainly went to the third party before consent, and the report names the country of the visit next to it. A service whose requests all failed is a hint with `beforeConsent` false.

Session fix-a1: a service is a finding only when a request with a known document reached it. A request whose document the capture does not know (a CORS preflight, a web worker or an iframe the adapter could not place) may come from an embedded third-party page, so a service seen only in such requests is a hint with the text `third-party-frame-unknown` ("bitte manuell prüfen"), no risk and no fix text, whatever its risk class.

## Element by element (`design/reference/bericht.html`)

Header and footer of the site (logo, "So prüfen wir", "BFSG-Check", "Neue Prüfung", footer links): static, no field.

Head:
- "Prüfbericht für roesterei-muster.de": `site.displayHost` (Unicode, without "www."); `site.host` and `site.url` keep the exact address. Only labels with Latin letters (ASCII, umlauts and accents of Latin-1 and Latin Extended-A) are shown decoded; a label in another script stays in punycode, so a look-alike domain never reads as a known name in a shared report.
- Buttons "Als PDF speichern", "Link kopieren", "An Entwickler weitergeben": actions of the page; the link is built from `id`.
- "Geprüft am 19. November 2026, 18:42 Uhr": `scan.scannedAt` (UTC; the page shows Europe/Berlin).
- "System WordPress mit WooCommerce": `platform.system`, `platform.woocommerce`, `platform.shopwareVersion`.
- "Geprüfte Seiten Startseite und Impressum": `pages.homepage`, `pages.impressum`.
- "Revision A, Erstprüfung": `revision` (always A and `initial` until stage D).

Prüfmaße (`measures`, in the order of the table; each row has `result` pass, fail, partial, manual or not-checked, and `target` and `actual` values):
- "Fremde Dienste vor der Einwilligung, Soll 0, Ist 3": `third-party-before-consent`, `actual.count` = services with severity `finding`.
- "Pflichtangaben im Impressum, 4 von 4": `impressum-fields`, `actual` = fields found of 4. Not all found gives `manual`, never `fail`.
- "Kleinster Textkontrast, mind. 4,5 : 1, 2,9 : 1": `lowest-contrast`, `actual.ratio` and `actual.expected`.
- "Bilder mit Beschreibung, alle, 12 von 17": `images-described`. Session fix-a2: `actual.count` = images with a text alternative (alt text, aria-label, aria-labelledby, title); `actual.total` = these plus images without one plus images axe could not decide. Images marked as decoration (`alt=""`, a presentation role) pass the axe rule but are in neither number: they are the manual check `a11y:image-alt:decorative` with their count. The row follows axe (session fix-a3, the owner's answer of 24.11.2026): `fail` when an image lacks a description, `pass` when none does (images marked as decoration do not change it), `manual` when axe could not decide an image. `actual` is null when the capture does not say how the passing images split (made before the fix).
- "Erklärung zur Barrierefreiheit, vorhanden, fehlt": `accessibility-statement`, `actual.state` found, uncertain or not-found; the result for not-found is `manual` (see the gaps).
- "Verschlüsselung, HTTPS": `https`, `actual.state` https, http or unknown.
- "Sicherheits-Header, 5 von 5, 2 von 5, teilweise": `security-headers`, `actual` = headers present of 5; `partial` when some are present.
- The sentence on the BFSG scheme: static.

"Drei Dinge sollten Sie zuerst beheben":
- The three entries: `priorities` (finding ids), each with `findings[].textId` for the title, `area` (privacy: "Datenschutz", accessibility: "Barrierefreiheit", …), `risk` (high, medium, low: "hohes/mittleres/niedriges Risiko"), `field` ("Feld B2").
- The plan of the homepage with the red marks: `findings[].field`. See the gaps.

"Zeitschnitt A–A: die ersten drei Sekunden" (`timeline`):
- Axis 0 to 3 s: `timeline.windowMs` (3000).
- Rows: `timeline.rows[]` with `label` (host, or host and path for the site's own files: "roesterei-muster.de/wp-content"), `party` own or third (bar style), `kind` document ("Ihre Seite"), files ("Ihre Dateien"), consent-tool, service; `provider` ("Google, fremder Server"); `startMs` and `endMs` (bar); `beforeBanner`.
- Cut A–A and "Einwilligungsbanner erscheint nach 1,4 s": `timeline.bannerVisibleAtMs`, `bannerToolId`.
- Legend: static.

"Stückliste der fremden Dienste" (`services`):
- "5 Dienste gefunden": the number of listed services.
- Pos., Dienst, Anbieter: `position`, `name`, `provider`; the small line ("Schriften", "lädt weitere Skripte", "Statistik"): from `category`.
- "Daten gehen an" ("Server in den USA möglich", "weltweites Servernetz"): `dataLocation`.
- "Startet" ("vor der Einwilligung"): `starts`, always `before-consent`.
- "Einwilligung" tag ("fehlt", "Graubereich"): `consent` missing, grey-zone, not-needed, not-reached (no request of the service got an answer, so no data is known to have arrived; not in the design), and manual (session fix-a1: the requests reached the service, but the scan cannot tell whether the page itself made them; not in the design).
- "Liste für die Datenschutzerklärung kopieren": built from `services`, `site.displayHost` and `scan.scannedAt`.

Finding detail ("fund-1"):
- Number, title, "Feld B2": the position in `priorities` or `findings`, `textId`, `field`.
- "Was passiert" ("zwei Dateien … 0,3 Sekunden nach dem Aufruf"): `textId` with `params.count`, `params.firstStartMs`, `params.provider`.
- Soll / Ist box ("0 Anfragen an Google", "2 Anfragen, vor dem Banner"): `params.provider`, `params.count`, `params.beforeBanner`.
- "Warum das wichtig ist": the text of `textId` (`third-party-precedent` for Google Fonts).
- "Gefunden im Quelltext": see the gaps; the report has the request addresses in `evidence`.
- "Montageanleitung" with tabs WordPress, Shopify, Wix, Jimdo, Shopware and "erkannt": `fixTextId` plus `platform.system` for the selected tab.

"Revisionen" (stage D, behind a flag): "A, 19.11.2026, Erstprüfung, 7 Funde, davon 3 vorrangig": `revision`, `scan.scannedAt`, `counts.findings` (plus `counts.manual` where the renderer counts manual checks), `priorities.length`. "B offen, Erneut prüfen" and the crossed-out example: stage D.

Help block, "Hilfe bei der Umsetzung anfragen", "Arbeitsauftrag": actions; the lead form (stage C) refers to `id`.

"Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit.": static, on every report.

Title block: "Objekt" `site.displayHost`, "Datum" `scan.scannedAt`, "Revision" `revision.letter`; "Prüfbericht", "Blatt 1 von 1", "automatisch" are static.

Not in the design but in the schema: `visit.country` and `visit.colo` (Fedor, 21.11.2026: the country in the head and next to every finding with `beforeConsent`), `legal` (links and the exact quotes of the fields), `security.headers` (each header with its text id), `notice`, `failure`, `sections`.

## What is missing

Data the scanner does not produce yet:
1. "Feld B2", "Feld A3" and the red marks on the plan: done in session fix-a6 (see below), best effort. A finding about a script or a font loaded from the head has no element with a box and keeps `field` null; the design shows such a finding with a field (Google Fonts in "Feld B2"). B3 shows no field mark when `field` is null.
2. "Gefunden im Quelltext" with the HTML tag (`<link rel="stylesheet" href="…fonts.googleapis.com…">`): the capture has the request address and the initiator, not the tag. A tag built from the address would claim something the scan did not see. Needs the element's HTML from the page snapshot (best effort).
3. "erst nach Klick" in "Startet" and "wird eingeholt" in "Einwilligung" (the YouTube row of the design): the scan sees only requests that happened, never a service that waits for a click. A consent placeholder could be read from the page in a later version.
4. The consent tool on the site's own server ("Einwilligungstool, Ihr Server" in the Zeitschnitt): requests to the own server are not told apart by tool; the row is shown only when the tool loads from its provider (`kind` consent-tool).
5. The design's small line "Produktvideo" names the use on the page; the scan knows only the category ("Video").
6. "Montageanleitung" texts per system exist only for Google Fonts (in the design); `fixTextId` names a text (`fix-<service>`) that stage B4 writes.

States the design does not show (B2 and B3 build them from existing elements and show them to Fedor):
7. A quick check (`quick`), a blocked check, a refused address (`not-allowed`), a failed check: the notice and a report without findings.
8. Prüfmaße results `manual` ("bitte manuell prüfen") and `not-checked`: the design has only erfüllt, nicht erfüllt and teilweise.
9. No banner seen (no cut A–A), or the banner after the three seconds of the window.
10. Fewer than three entries for "Drei Dinge" (or none), and a report with no findings at all.
11. The country of the visit in the head and next to findings with `beforeConsent`.
12. System "unbekannt": no tab carries "erkannt".
13. The tag `not-reached` in the Stückliste (a service whose requests never got an answer), and a domain shown in punycode.
15. Session fix-a1: the tag `manual` in the Stückliste and the hint `third-party-frame-unknown` (a service seen only in requests whose document is unknown).
16. Session fix-a1: the notice `report-page-almost-empty` on a `complete` report, with Prüfmaße that are `manual` instead of "erfüllt". Since fix-a2 such a report has no findings and no hints at all, and every checked Prüfmaß is `manual` without a value.
17. Session fix-a4: `truncated` (a list shorter than `counts`; parts of the page read only up to a limit), the failed report with the reason `page-limit`, the header status `manual` with the text `security-header-too-long`, the manual check `legal-impressum-no-link-links-cut`, and a part that is `not-checked` with the reason `analyzer-error`.

Conflict with a product rule (decided):
14. The design shows the accessibility statement as "fehlt" and "nicht erfüllt". By product rule 3 a statement the scan did not find is "nicht gefunden, bitte manuell prüfen" (it can be linked from another page), so the schema gives `actual.state` not-found with result `manual`. Fedor confirmed this on 23.11.2026 (message of A5 part 3): the report shows "nicht gefunden, bitte manuell prüfen", never "fehlt".

Session fix-a2, the quick check: a missing Impressum link is `legal-impressum-no-link-quick` without a risk (the HTML source does not hold what a script builds). When the source holds no text and no link at all, `sections.legal` and `sections.platform` are `not-checked` with the reason `quick-check`, and `legal` and `platform` are null. A `blocked` report of a quick check has `quickCheck: true` in the parameters of its notice `report-blocked`: the full check is possible again the next day, and such a report is not reused from the cache.

Session fix-a3, mandatory information: `legal.datenschutzLink` holds only a link to a page of the site itself. A link to another site or to an anchor of the homepage is not shown there; the finding `legal:datenschutz` is then the manual check `legal-datenschutz-uncertain` with `params.reason` `other-site` or `same-page` (draft in `docs/content-drafts.md`). `legal.accessibilityStatement.certain` is true only for a link whose text or address is the name of the statement. `legal.impressum.state` `failed` also stands for a page behind the link that is no Impressum (an error page with HTTP 200, the homepage again, a page without any sign of an Impressum): `pages.impressum` is then `not-checked` and no field is searched. The quotes in `legal.fields` are parts of the page text without invisible characters (soft hyphen, zero-width characters).

Session fix-a4, limits (`scanner/src/capture/limits.ts`; drafts in `docs/content-drafts.md`):
- `truncated.findings` and `truncated.services` are true when the list is shorter than `counts` says (60 findings, 80 services, or fewer when the report had to be made smaller to stay within 400,000 characters; then each finding also keeps one piece of evidence and each service two hosts and sources).
- `truncated.page` names what the scan read only up to a limit: `homepage-text`, `impressum-text` (100,000 characters), `homepage-links`, `impressum-links` (more than 1,500 links, or links with an address longer than 2,000 characters or beyond 300,000 characters of addresses on one page), `headers` (a header value longer than 16,000 characters, not analysed). Empty when everything was read.
- A page over the limits of a capture (more than 2,000 requests, more than 500,000 characters of request addresses, or more than 2 MB of data) is a `failed` report with `failure.reason` and the notice parameter `reason` `page-limit`: no findings, as for every failed check.
- A security header that was not analysed has the status `manual` and the text `security-header-too-long`. A missing Impressum link is `legal-impressum-no-link-links-cut` without a risk when `truncated.page` contains `homepage-links`.
- Values of the page are in the report only in the form the schema names: `scan.axeVersion` is a version number or null, the `expected` of a contrast is of the form "4.5:1" or null, `timeline.bannerToolId` is an id of lower-case letters, digits and hyphens or null, counts are at most 100,000.
- A part of the analysis that threw is `not-checked` with the reason `analyzer-error` in `sections`, with one item `scan:not-analysed:<part>` (`section-not-analysed`); the other parts stand.

Texts that do not exist yet (ids used by the builder; drafts follow in B3 and B4): `report-quick-incomplete`, `report-blocked`, `report-not-allowed`, `report-failed`, `third-party-precedent`, `third-party-consent-required`, `third-party-usually-consent`, `third-party-grey-zone`, `third-party-unconfirmed`, `third-party-unknown`, `security-headers`, `security-http-redirect-not-checked`, `legal-not-checked`, `legal-impressum-same-page`, `legal-impressum-pdf`, `legal-impressum-failed`, `legal-impressum-not-checked`, `legal-field-not-found`, `legal-datenschutz-no-link`, `legal-accessibility-statement-not-found`, and the `fix-<service>` texts.

Session fix-a6 (the last polishing session of stage A):
- `failure.reason` `not-html`: the main document answered with a content type other than HTML (JSON, PDF, an image, plain text); a `failed` report, no findings.
- `scan.stopReason`: `network-quiet` (the page had loaded), `max-wait` (after 15 seconds the page was still loading; B3 says so with the draft text `report-page-still-loading`), `fetched` (the quick check), null when the page did not load.
- `findings[].field`: the field of the plan of the homepage (`A1` to `D3`, columns from the left, rows from the top, over the whole page). An accessibility finding takes the field of its first example element, a third-party finding the field of the first element that loads a file of its hosts and has a box (an image, an iframe, a video). Null when there is none, and in reports of captures made before the session.
- `legal.fields.*` found: `source` `text` (the quote is a part of the page text) or `link` (the quote is the e-mail address a mailto link or Cloudflare's e-mail protection names; never the link itself).
- `legal.impressumLink.href`, `legal.datenschutzLink.href`, `legal.accessibilityStatement.href`, `legal.impressum.url`: http or https only, without user name and password, and null when the address is longer than 300 characters (never a shortened address).
- `evidence.via` of a request: only an http, https, ws or wss address, otherwise null.
- The manual check `security:http-redirect` (`security-http-redirect-manual`) has `params.reason` (`timeout`, `http-error`, `too-many-redirects`, `no-location`, `not-allowed`, `script-may-redirect`, `refresh-to-http`, `page-not-read`, `final-http`, `unknown`) and `params.status` (the last status of the http:// check, or null). `final-http`: the plain requests reached https://, but the page ended on http://.
- The manual check `a11y:frame-content` (`a11y-frame-not-checked`, `params.share` in percent): an iframe covers at least half of the first screen; what it shows was not checked, and the rows "Kleinster Textkontrast" and "Bilder mit Beschreibung" are `manual` instead of `pass`. A frame over a quarter of the first screen on a page where axe checked at most two elements makes the whole part `not-checked`.
- "Kleinster Textkontrast" without a measured contrast is `not-checked`, never `pass`. "Sicherheits-Header" is `manual` when a header that does not count has the status `manual`.
- New header texts: `security-header-referrer-policy-weak` (`unsafe-url` or `no-referrer-when-downgrade`, weaker than the browser's default), `security-header-permissions-policy-open` (every feature allowed everywhere), `security-header-hsts-duplicate` (a repeated directive); `security-header-csp-invalid` is used now for a policy without any directive. None of them counts in "{n} von 5". A CSP meta element counts only as a child of `<head>`.

Session B2 part 2:
- `scan.requests` (`total`, `thirdParty`): the http and https requests of the homepage the scan recorded and how many of them went to third parties, for the row "17 Anfragen aufgezeichnet, davon 9 an fremde Server" of the scan screen; null when the third-party part was not checked. The property is not required, so reports made before stay valid; the schema version stays 1 (no renderer read reports before B2).

Session B3 part 2 (two optional fields; reports made before stay valid, the schema version stays 1):
- `findings[].evidence[].initiatorType` (request evidence only): the browser's initiator type of the request in a closed list, `parser`, `script`, `preload`, `preflight`, `other` (any other type), or null when the capture does not say. `parser` with a `via` that is the homepage document (origin and path of `site.finalUrl`) means the tag stands in the served source of the homepage: only then the scan screen and the plan of the report put the mark "im Quelltext" (`inPageSource` of `web/lib/scan-view.ts`), and only then B4 shows "Gefunden im Quelltext" (with the request address; the tag itself stays gap 2).
- `timeline.rows[].fileTypes`: for a row of kind `files`, the types of the site's own files of the row (`stylesheet`, `font`, `script`, `image`, `media`, `data` for xhr, fetch, event streams and web sockets, `other`), each once, in this order; null for every other row. The page writes "Ihre Dateien: Design und Skripte" (style sheets and fonts, scripts) and the other words only for types that are there (Fedor's answer 1 of B3 part 1; gap of B3 part 1 closed).
- The states of the upper part that the design does not show (gaps 7 to 12, 16, 17) are built in B3 part 2 (`docs/content-drafts.md`, "Session B3 part 2"); the country of the visit is the fifth fact of the head. Next to the findings with `beforeConsent` it follows in B4 with the finding details.

## Strings of the scanned page (requirements for stage B)

The report carries text that the scanned site chose: page text, link texts and addresses, HTML snippets, selectors, header values, host names and the reasons of errors. Our own site shows a report to anyone who has its link, so a site that is checked must never get its own markup or script into our page, and must never make its text look like ours. The schema marks every such field with a `description` that starts with what it is and says "untrusted". The builder already removes C0 and C1 controls (except tab and line break), bidi controls, U+200B and U+FEFF, makes every string well formed and never cuts inside a character; stage B must still follow these rules.

Fields with text of the page: `site.finalUrl`; `sections.*.reason` and `params.reason`, `params.service`, `params.value`; `findings[].serviceKey`, `services[].key`, `services[].name` (from the page when `known` is false), `services[].hosts`, `timeline.rows[].label` and `.serviceKey`; `evidence.url`, `evidence.via`, `evidence.target`, `evidence.html` (raw markup), `evidence.value`, `security.headers[].value`; `legal.*.href`, `legal.*.text`, `legal.impressum.url`, `legal.fields.*.quote` (with line breaks). `site.url`, `site.host` and `site.displayHost` come from the visitor and are normalised; treat them the same way. In D1, `scans.report` holds all of these; `network_requests.host` and `service_key` and `findings.service_key` hold host names of the page.

Showing text:
- Every string of the report is a React text node. No `dangerouslySetInnerHTML`, no Markdown, no HTML template with values put in. This holds for `evidence.html` too: "Gefunden im Quelltext" builds its highlighting from nodes, never from an HTML string.
- Strings of the page are wrapped in `<bdi>` (or an element with `dir="auto"` and `unicode-bidi: isolate`), so a right-to-left text cannot turn the sentence around it. Long hosts (up to 253 characters) and values (up to 300) get `overflow-wrap: anywhere`; quotes keep their line breaks with `white-space: pre-line`.
- Texts with parameters are filled in one pass over the template (a replace with a function), each value as a text node, so a value that looks like a placeholder (`{count}.beispiel.example`) is never filled in a second time. An unknown `textId` gets a general text, never the id itself.
- `reason` and `bannerToolId` are never shown as they are: known codes and tool ids map to fixed German phrases and names; anything else gets a general text.
- Before `encodeURIComponent` (a link to share, a mailto, the lead form) call `toWellFormed()` on the string.

Links:
- Only `site.url`, `site.finalUrl`, `legal.*.href` and `legal.impressum.url` may become links, and only after a check in the browser: `new URL(value)` without a base address works, the protocol is `http:` or `https:`, user name and password are empty, the value does not end with "…". The `href` is the parsed address (`.href`), with `rel="noopener noreferrer nofollow"` and `referrerpolicy="no-referrer"`. A null `href` (an address too long to keep) is shown as text.
- `evidence.url`, `evidence.via`, the quotes and every other string are never links.

The copy button ("Liste für die Datenschutzerklärung kopieren"):
- It writes plain text only, with `navigator.clipboard.writeText`.
- For a known service (`known: true`) it takes name and provider from our rules data. An unknown service goes on a line of its own with its host, or is left out. Controls are removed; a line that starts with `=`, `+`, `-` or `@` gets an apostrophe in front, so a spreadsheet does not read it as a formula.

The page of the report:
- Headers: `Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` (the inline scripts of the Next.js static export need hashes), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`.
- The report JSON is never put into the HTML or a `<script>` element (a stored string can contain `</script>`). The page fetches it, checks `schemaVersion` and validates it with `validateReport` (it runs in the browser) before it shows anything.
- Privacy: `scans.report` holds the quotes of the Impressum (postal address, e-mail, register entry, VAT id) until the scan is deleted; the deletion schedule is decided in stage C (`docs/backlog.md`).

## Risk and order (confirmed by Fedor on 23.11.2026)

- Privacy: precedent and consent-required services are a finding with high risk. Services of the class usually-consent (maps, video embeds, external chat widgets, review widgets) are a finding with medium risk, never high (Fedor's correction of 23.11.2026; test in `scanner/test/report.test.ts`). Grey-zone services, unknown third parties and services whose requests never reached the server are hints without a risk.
- Mandatory information: a missing Impressum link is a manual check with high risk (Fedor, 22.11.2026); every other missing link or field is a manual check without a risk. The accessibility statement is listed as a manual check when the link is unsure, or when it was not found on a shop (WooCommerce, Shopify, Shopware).
- Accessibility: each of the six error types with violations is one finding with medium risk (the design shows contrast as "mittleres Risiko"); undecided elements are manual checks.
- Security: no HTTPS is a finding with high risk, no redirect from http to https medium, missing headers one finding with low risk. Session fix-a2: no HTTPS is a finding only when https:// was asked (otherwise `manual`, `security-https-manual`); a redirect inside the page (`security-http-redirect-in-page`) is a hint without a risk, a script that may redirect a manual check.
- Order: findings before manual checks before hints before checks that did not run; then high before medium before low; then privacy, mandatory information, accessibility, security; then the order of the analysis. The first three entries with a risk are the "Drei Dinge". Session fix-a6 (review finding 70): "Drei Dinge" are chosen by risk first, then findings before manual checks, so a manual check with a high risk (no Impressum link found) is never pushed out by a finding with a lower risk; the list of findings keeps the order above.
