# Report schema v1 and the design reference

Session A5 part 2 (23.11.2026). The report JSON has a versioned schema: `scanner/schema/report.v1.schema.json` (JSON Schema 2020-12, the subset that `scanner/src/report/validate.ts` implements; a unit test compares the validator with Ajv). TypeScript types: `scanner/src/report/types.ts`. Builder: `buildReport` in `scanner/src/report/build.ts`. Stage B renders the report page from this JSON.

The report holds facts, states, text ids and their parameters, never finished German sentences. Texts live in the repository (`docs/content-drafts.md`), so nothing is written at runtime. Ids of texts that do not exist yet are listed at the end.

## States

`state` is one of:

- `complete`: the full check with the browser.
- `quick`: the daily browser limit was reached and only the quick check without a browser ran (part 3). `notice.textId` is `report-quick-incomplete` ("Die vollständige Prüfung ist morgen wieder möglich."); the sections that need the browser (third-party services, accessibility) are `not-checked` with the reason `quick-check`.
- `blocked`: the site refused the scan (check page, bot protection). No findings, no Prüfmaße, notice `report-blocked`.
- `not-allowed`: refused by the SSRF protection (`failure.reason` `not-allowed`, notice `report-not-allowed` with the rule as `rejection`). No findings.
- `failed`: the homepage did not load (timeout, unreachable, HTTP error). No findings, notice `report-failed`.

`sections` says for each part (third-party, accessibility, security, mandatory information, system) whether it was checked and why not (`quick-check`, `page-not-loaded`, `page-not-read` when the page loaded but its text and links could not be read, or the analyzer's reason). A check that did not run is never shown as "keine Funde".

`findings[].beforeConsent` is true only when a request of the service got an answer: then data certainly went to the third party before consent, and the report names the country of the visit next to it. A service whose requests all failed is a hint with `beforeConsent` false.

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
- "Bilder mit Beschreibung, alle, 12 von 17": `images-described`, `actual` = images with a description of all images.
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
- "Einwilligung" tag ("fehlt", "Graubereich"): `consent` missing, grey-zone, not-needed, and not-reached (no request of the service got an answer, so no data is known to have arrived; not in the design).
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
1. "Feld B2", "Feld A3" and the red marks on the plan: the capture records no positions of elements. `field` is null in every report. It needs the bounding box of each example element (axe gives selectors) and of the element that loads a third-party file, mapped to the 4 × 3 grid. Costs browser time; to be decided (question in the report of part 2).
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

Conflict with a product rule (decided):
14. The design shows the accessibility statement as "fehlt" and "nicht erfüllt". By product rule 3 a statement the scan did not find is "nicht gefunden, bitte manuell prüfen" (it can be linked from another page), so the schema gives `actual.state` not-found with result `manual`. Fedor confirmed this on 23.11.2026 (message of A5 part 3): the report shows "nicht gefunden, bitte manuell prüfen", never "fehlt".

Texts that do not exist yet (ids used by the builder; drafts follow in B3 and B4): `report-quick-incomplete`, `report-blocked`, `report-not-allowed`, `report-failed`, `third-party-precedent`, `third-party-consent-required`, `third-party-usually-consent`, `third-party-grey-zone`, `third-party-unconfirmed`, `third-party-unknown`, `security-headers`, `security-http-redirect-not-checked`, `legal-not-checked`, `legal-impressum-same-page`, `legal-impressum-pdf`, `legal-impressum-failed`, `legal-impressum-not-checked`, `legal-field-not-found`, `legal-datenschutz-no-link`, `legal-accessibility-statement-not-found`, and the `fix-<service>` texts.

## Risk and order (confirmed by Fedor on 23.11.2026)

- Privacy: precedent and consent-required services are a finding with high risk. Services of the class usually-consent (maps, video embeds, external chat widgets, review widgets) are a finding with medium risk, never high (Fedor's correction of 23.11.2026; test in `scanner/test/report.test.ts`). Grey-zone services, unknown third parties and services whose requests never reached the server are hints without a risk.
- Mandatory information: a missing Impressum link is a manual check with high risk (Fedor, 22.11.2026); every other missing link or field is a manual check without a risk. The accessibility statement is listed as a manual check when the link is unsure, or when it was not found on a shop (WooCommerce, Shopify, Shopware).
- Accessibility: each of the six error types with violations is one finding with medium risk (the design shows contrast as "mittleres Risiko"); undecided elements are manual checks.
- Security: no HTTPS is a finding with high risk, no redirect from http to https medium, missing headers one finding with low risk.
- Order: findings before manual checks before hints before checks that did not run; then high before medium before low; then privacy, mandatory information, accessibility, security; then the order of the analysis. The first three entries with a risk are the "Drei Dinge".
