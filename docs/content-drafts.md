# Content drafts

Every German text in this file is a DRAFT. The agent wrote these texts in session A3 (21.11.2026), and nobody has reviewed them yet. Fedor checks them first, and a native speaker reviews them later (stage C). Until then the scanner may use them only as drafts and must never present them as final. The texts in `design/` stay final and take precedence: where a draft reuses a text from `design/reference/bericht.html`, the section says so.

## Conventions

- Each section has: the text id, the title as the report shows it, the fact and the general risk ("Was passiert"), the general fix, a one-line note on when the text is used, and the status. The system tabs (WordPress, Shopify, Wix, Jimdo, Shopware) come later and are not part of these drafts.
- Placeholders: `{count}` is a number of places (axe nodes) and is at least 2 in plural titles; a singular variant is given for 1. `{check}` is the German name of the check as the report lists it: Kontrast, Bilder, Formularfelder, Links, Schaltflächen or Seitensprache (both language rules). `{ratio}` and `{expected}` are contrast values in the German format of the design, for example "2,9 : 1" and "4,5 : 1". `{value}` is a header value or attribute value exactly as received, HTML-escaped and shortened (with "…"). `{reason}` is one of the fixed German phrases listed in its section. `{status}` is an HTTP status number.
- The examples per rule (selector, HTML snippet of at most 200 characters, contrast values) are data shown under the text; they are not part of these texts.
- The wording rules of the brief (product rules 3 and 4) were checked sentence by sentence. Unsure cases say "bitte manuell prüfen". No text in this file names a law. Accessibility texts do not say that the BFSG applies to the visitor (the report links the BFSG scheme, as in the design). Security header texts do not say that a law requires the header, because no law names these headers.

## Accessibility

### `a11y-color-contrast`

- Title: Zu schwacher Kontrast an {count} Stellen (final, from `design/reference/bericht.html`). Singular (draft): Zu schwacher Kontrast an einer Stelle
- Fact and risk: An {count} Stellen hebt sich der Text zu wenig vom Hintergrund ab, der schwächste Wert liegt bei {ratio} statt mindestens {expected}. Menschen mit Sehschwäche und alle, die bei Sonnenlicht aufs Handy schauen, können ihn schwer lesen.
- Singular variant of the first sentence: An einer Stelle hebt sich der Text zu wenig vom Hintergrund ab, der Wert liegt bei {ratio} statt mindestens {expected}.
- Fix: Ändern Sie an diesen Stellen die Text- oder die Hintergrundfarbe, bis der Kontrast mindestens 4,5 : 1 erreicht, bei großer Schrift (ab 24 Pixel, fett ab etwa 19 Pixel) 3 : 1. Oft steckt eine einzige Farbe aus den Design-Einstellungen dahinter, dann genügt eine Änderung.
- Used when: axe `color-contrast` reports at least one violation; `{ratio}` is the lowest contrast ratio among the violations and `{expected}` the required ratio of that same element.
- WCAG: 2.2 SC 1.4.3 Contrast (Minimum), level AA: 4.5:1 for normal text, 3:1 for large text (at least 18 pt, or 14 pt bold; 18 pt are 24 CSS pixels, 14 pt about 18.7 CSS pixels).
- Status: Entwurf

### `a11y-image-alt`

- Title: {count} Bilder ohne Beschreibung. Singular: Ein Bild ohne Beschreibung
- Fact and risk: {count} Bilder haben keinen Alternativtext, also keine kurze Beschreibung im Attribut alt. Wer einen Screenreader nutzt, hört an diesen Stellen nur den Dateinamen oder gar nichts.
- Singular variant of the first sentence: Ein Bild hat keinen Alternativtext, also keine kurze Beschreibung im Attribut alt.
- Fix: Geben Sie jedem Bild, das etwas Wichtiges zeigt, einen kurzen Alternativtext, der sagt, was darauf zu sehen ist. Rein dekorative Bilder bekommen ein leeres Attribut alt="", dann überspringt der Screenreader sie.
- Used when: axe `image-alt` reports at least one violation. Images with `alt=""` or a presentation role pass the axe rule, but since session fix-a2 they are not counted as images with a description: they get the text `a11y-image-alt-decorative` below. The word "Beschreibung" follows the design row "Bilder mit Beschreibung".
- WCAG: 2.2 SC 1.1.1 Non-text Content, level A.
- Status: Entwurf

### `a11y-image-alt-decorative`

- Title: {count} Bilder sind als Schmuckbilder markiert, bitte manuell prüfen. Singular: Ein Bild ist als Schmuckbild markiert, bitte manuell prüfen
- Fact and risk: {count} Bilder haben ein leeres Attribut alt="" oder die Rolle „presentation“. Ein Screenreader überspringt solche Bilder. Das ist richtig, wenn ein Bild nur schmückt. Zeigt es dagegen etwas Wichtiges, etwa ein Produkt oder Ihr Team, fehlt an dieser Stelle die Beschreibung. Das kann die automatische Prüfung nicht unterscheiden. Diese Bilder gelten deshalb nicht als Fehler: Im Prüfmaß „Bilder mit Beschreibung“ zählen sie weder als beschrieben noch als unbeschrieben, und das Prüfmaß bleibt „erfüllt“, solange keinem Bild die Beschreibung fehlt.
- Singular variant of the first sentence: Ein Bild hat ein leeres Attribut alt="" oder die Rolle „presentation“.
- Fix: Bitte manuell prüfen: Sehen Sie diese Bilder durch. Wo ein Bild Inhalt trägt, tragen Sie einen kurzen Alternativtext ein. Viele Systeme setzen alt="" von selbst, wenn beim Hochladen kein Text eingegeben wurde. Reine Schmuckbilder bleiben, wie sie sind.
- Used when: at least one image passes axe `image-alt` without a text alternative, because it is marked as decoration (`alt=""`, `role="presentation"` or `role="none"`). A manual check without a risk, shown next to `a11y-image-alt` when both apply. New in session fix-a2. Changed in session fix-a3 (the owner's answer of 24.11.2026): the Prüfmaß follows axe, so these images no longer turn the row into "bitte manuell prüfen"; the sentence about the Prüfmaß was rewritten.
- WCAG: 2.2 SC 1.1.1 Non-text Content, level A (decoration is to be marked so that assistive technology can ignore it; whether an image is decoration is a judgement).
- Status: Entwurf

### `a11y-label`

- Title: {count} Formularfelder ohne Beschriftung. Singular: Ein Formularfeld ohne Beschriftung
- Fact and risk: {count} Formularfelder haben keine Beschriftung, die technisch mit dem Feld verbunden ist. Ein Screenreader kann dann nicht ansagen, was in das Feld gehört, etwa Name oder E-Mail-Adresse.
- Singular variant of the first sentence: Ein Formularfeld hat keine Beschriftung, die technisch mit dem Feld verbunden ist.
- Fix: Verbinden Sie jedes Formularfeld mit einer sichtbaren Beschriftung, im HTML mit `<label for="…">` und derselben id am Feld. Wo kein sichtbarer Text passt, etwa bei einem Suchfeld mit Lupe, hilft ein unsichtbarer Name mit aria-label.
- Used when: axe `label` reports at least one violation (an input or textarea without an accessible name). Select elements are not covered by this rule (axe checks them with `select-name`, which we do not run).
- WCAG: 2.2 SC 4.1.2 Name, Role, Value, level A (the axe tag of the rule); related: SC 1.3.1 Info and Relationships and SC 3.3.2 Labels or Instructions, both level A.
- Status: Entwurf

### `a11y-link-name`

- Title: {count} Links ohne Text. Singular: Ein Link ohne Text
- Fact and risk: {count} Links haben keinen Text, den ein Screenreader vorlesen kann, oft sind es Symbole oder Bilder ohne Beschreibung. Wer die Seite nicht sieht, erfährt nicht, wohin diese Links führen.
- Singular variant: Ein Link hat keinen Text, den ein Screenreader vorlesen kann. Meist steckt ein Symbol oder ein Bild ohne Beschreibung dahinter. Wer die Seite nicht sieht, erfährt nicht, wohin dieser Link führt.
- Fix: Geben Sie jedem Link einen Text, der sein Ziel nennt. Bei einem Symbol, etwa für Instagram, genügt ein unsichtbarer Name wie aria-label="Instagram" oder ein Alternativtext am Bild im Link.
- Used when: axe `link-name` reports at least one violation (a link without an accessible name).
- WCAG: 2.2 SC 2.4.4 Link Purpose (In Context), level A; SC 4.1.2 Name, Role, Value, level A.
- Status: Entwurf

### `a11y-button-name`

- Title: {count} Schaltflächen ohne Text. Singular: Eine Schaltfläche ohne Text
- Fact and risk: {count} Schaltflächen haben keinen Namen, den ein Screenreader vorlesen kann. Häufig sind es Menüsymbole oder die Pfeile eines Bilderkarussells. Wer die Seite nicht sieht, erfährt nicht, was diese Schaltflächen auslösen.
- Singular variant: Eine Schaltfläche hat keinen Namen, den ein Screenreader vorlesen kann. Oft ist das ein Menüsymbol oder einer der Pfeile eines Bilderkarussells. Wer die Seite nicht sieht, erfährt nicht, was diese Schaltfläche auslöst.
- Fix: Geben Sie jeder Schaltfläche einen sichtbaren Text oder, bei reinen Symbolen, einen unsichtbaren Namen wie aria-label="Menü öffnen".
- Used when: axe `button-name` reports at least one violation (a `<button>` element without an accessible name). Input buttons and elements with role=button are checked by other axe rules (`input-button-name`, `aria-command-name`), which we do not run.
- WCAG: 2.2 SC 4.1.2 Name, Role, Value, level A.
- Status: Entwurf

### `a11y-html-has-lang`

- Title: Seitensprache nicht angegeben
- Fact and risk: Ihre Seite gibt im Quelltext keine Sprache an, das Attribut lang am html-Element ist nicht gesetzt oder leer. Screenreader lesen den Text dann in ihrer eingestellten Sprache vor; ist das eine andere Sprache als die Ihrer Seite, klingt die Aussprache oft falsch.
- Fix: Tragen Sie die Sprache am Anfang des Quelltexts ein, für eine deutsche Seite: `<html lang="de">`. In vielen Systemen geschieht das über die Spracheinstellung der Website.
- Used when: axe `html-has-lang` reports a violation (the html element has no lang attribute, or an empty one).
- WCAG: 2.2 SC 3.1.1 Language of Page, level A.
- Status: Entwurf

### `a11y-html-lang-valid`

- Title: Ungültige Seitensprache: {value}
- Fact and risk: Ihre Seite gibt als Sprache „{value}“ an, das ist kein gültiger Sprachcode. Screenreader erkennen die Sprache dann nicht sicher und lesen womöglich mit der falschen Aussprache vor.
- Fix: Tragen Sie einen gültigen Code ein, für Deutsch lang="de" oder lang="de-DE". Achten Sie auf den Bindestrich: de_DE mit Unterstrich ist kein gültiger Code.
- Used when: axe `html-lang-valid` reports a violation (lang is set but its value is not a valid language code); `{value}` is the value of the lang attribute of the html element, shortened to 40 characters. Known gap: axe also checks xml:lang, and this text does not name it; if only xml:lang is invalid, `{value}` shows the lang value.
- WCAG: 2.2 SC 3.1.1 Language of Page, level A.
- Status: Entwurf

### `a11y-manual-check`

- Title: Bitte manuell prüfen: {check}, {count} Stellen. Singular: Bitte manuell prüfen: {check}, eine Stelle
- Fact and risk: An {count} Stellen konnte die automatische Prüfung nicht entscheiden, ob eine Barriere besteht.
- Singular variant: An einer Stelle konnte die automatische Prüfung nicht entscheiden, ob eine Barriere besteht.
- Fix: Bitte prüfen Sie diese Stellen manuell. Die Beispiele unten zeigen, wo sie liegen.
- Singular variant of the fix: Bitte prüfen Sie diese Stelle manuell. Das Beispiel unten zeigt, wo sie liegt.
- Used when: axe returns "incomplete" results for one of the rules on this page other than `color-contrast` (that case uses `a11y-manual-check-contrast`); one text per check, `{count}` is the number of incomplete nodes of that check. Never counted as a violation and never changes the Prüfmaße.
- Status: Entwurf

### `a11y-manual-check-contrast`

- Title: Bitte manuell prüfen: Kontrast, {count} Stellen. Singular: Bitte manuell prüfen: Kontrast, eine Stelle
- Fact and risk: An {count} Stellen konnte die automatische Prüfung nicht entscheiden, ob der Kontrast ausreicht, zum Beispiel bei Text über einem Bild oder einem Farbverlauf. Ob dort eine Barriere besteht, wissen wir nicht.
- Singular variant of the first sentence: An einer Stelle konnte die automatische Prüfung nicht entscheiden, ob der Kontrast ausreicht, zum Beispiel bei Text über einem Bild oder einem Farbverlauf.
- Fix: Bitte prüfen Sie diese Stellen manuell. Die Beispiele unten zeigen, wo sie liegen. Bei Text über Bildern hilft oft eine einfarbige, halbtransparente Fläche hinter dem Text.
- Singular variant of the first two sentences of the fix: Bitte prüfen Sie diese Stelle manuell. Das Beispiel unten zeigt, wo sie liegt.
- Used when: axe `color-contrast` returns "incomplete" results on this page; `{count}` is the number of those nodes. Never counted as a violation and never changes the Prüfmaße.
- Status: Entwurf

### `a11y-not-checked`

- Title: Barrierefreiheit nicht geprüft
- Fact and risk: Die automatische Prüfung der Barrierefreiheit ist auf dieser Seite nicht durchgelaufen (Grund: {reason}). Über Kontrast, Bilder, Formularfelder, Links, Schaltflächen und Seitensprache können wir hier deshalb nichts sagen.
- Fix: Starten Sie später eine neue Prüfung. Bis dahin gilt für diese Punkte: bitte manuell prüfen.
- Used when: axe did not finish on the page (timeout or error), or the capture has no accessibility data because it was made without a browser, or the page shows its content in a frameset or in one iframe over almost the whole window (frames are not checked); `{reason}` is "Zeitüberschreitung", "technischer Fehler", "Schnellprüfung ohne Browser" or "Inhalt in einem Frame, den wir nicht prüfen". The analyzer gives its reason in English (for example "no accessibility data in this capture"); the renderer maps it to one of these phrases, and the report names the page (Startseite or Impressum) next to the text.
- Status: Entwurf

### `a11y-check-not-checked`

- Title: Bitte manuell prüfen: {check}
- Fact and risk: Die automatische Prüfung dieses Punkts ist auf dieser Seite nicht vollständig durchgelaufen. Ob es hier Barrieren gibt, können wir deshalb nicht sagen.
- Fix: Starten Sie später eine neue Prüfung. Bis dahin: bitte manuell prüfen.
- Used when: the axe rule of this error type threw inside axe (`ruleErrors`); axe then drops the rule's whole result, so neither violations nor undecided places of this type are shown.
- Status: Entwurf

### `a11y-no-findings`

- Title: Keiner der sechs häufigsten Fehler gefunden
- Fact and risk: Auf dieser Seite haben wir keinen der sechs geprüften Fehlertypen gefunden: Kontrast, Bilder, Formularfelder, Links, Schaltflächen und Seitensprache. Eine automatische Prüfung erfasst aber nur einen Teil der Barrierefreiheit und ist kein Nachweis, dass Ihre Seite barrierefrei ist oder die WCAG erfüllt.
- Fix: Bei diesen sechs Punkten haben wir nichts gefunden. Vieles lässt sich nur von Menschen prüfen, zum Beispiel ob alles per Tastatur bedienbar ist und ob die Texte verständlich sind.
- Optional sentence, placed directly after the first sentence of the fix: Prüfen Sie nur die Stellen, die unter „Bitte manuell prüfen“ stehen.
- Used when: all seven rules ran on the page, none threw, and they returned 0 violations; it may appear together with `a11y-manual-check` or `a11y-manual-check-contrast`, and only then the optional sentence is added. Not used when any error type is `a11y-check-not-checked`. "Häufigsten" relies on the WebAIM Million (see Sources).
- Status: Entwurf

## Security

Shared note for all header texts: they describe a common protective measure and its effect. None of them says that a law requires the header.

### `security-https-ok`

- Title: Verschlüsselt über HTTPS
- Fact and risk: Ihre Seite wird verschlüsselt über HTTPS ausgeliefert. Was Besucher sehen und eingeben, wird auf dem Weg zwischen Browser und Server verschlüsselt übertragen.
- Fix: Kein Handlungsbedarf. Achten Sie darauf, dass Ihr Zertifikat automatisch verlängert wird.
- Used when: the final address of the homepage is https:// and it loaded without a certificate error (Prüfmaße row "Verschlüsselung": erfüllt).
- Status: Entwurf

### `security-https-missing`

- Title: Seite ohne HTTPS
- Fact and risk: Ihre Seite wird ohne HTTPS ausgeliefert, also unverschlüsselt. Wer sich im selben Netz befindet, etwa in einem öffentlichen WLAN, kann Inhalte und Formulareingaben sehen oder verändern; viele Browser zeigen dazu den Hinweis „Nicht sicher“.
- Fix: Richten Sie ein SSL/TLS-Zertifikat ein. Viele Hoster bieten kostenlose Zertifikate, etwa von Let’s Encrypt, mit wenigen Klicks an. Leiten Sie danach alle Aufrufe von http:// dauerhaft auf https:// weiter.
- Used when (changed in session fix-a2): the homepage ended on http:// and the scan asked for https:// itself: the address was entered with https:// and the site sent the browser to http://, or the address was entered with http:// and one request to its https:// address was refused (nothing listens there) or answered with a redirect back to http://. Never from the final address alone, and not for a reset connection or a certificate error (then `security-https-manual`). No HSTS text is shown on such a page. Note for review: Art. 32(1)(a) GDPR names encryption as an example of a suitable measure; a sentence on this could be added after review, it is deliberately not in the draft.
- Status: Entwurf

### `security-https-manual`

- Title: Verschlüsselung: bitte manuell prüfen
- Fact and risk: Wir konnten nicht feststellen, ob Ihre Seite über HTTPS ausgeliefert wird. Das ist kein Fund, sondern eine offene Frage.
- Fix: Bitte manuell prüfen: Rufen Sie Ihre Seite mit https:// auf und achten Sie auf das Schloss in der Adresszeile.
- Used when: the scanner cannot tell whether the final page of the homepage was delivered over HTTPS; since session fix-a2 also when the address was entered with http://, the page stayed there, and the request to its https:// address gave no clear answer (an error page, no answer in time, a reset connection, a certificate the scanner does not accept), went to another host than the page ended on, or was never made (a capture saved before the fix). Not a finding. Note for review: current Chrome versions show a settings symbol instead of the lock in the address bar; Firefox and Safari still show a lock.
- Status: Entwurf

### `security-https-available`

- Title: Verschlüsselt über HTTPS erreichbar
- Fact and risk: Ihre Seite ist unter https:// verschlüsselt erreichbar. Geprüft haben wir die Adresse mit http://, so wie sie eingegeben wurde; dort antwortet Ihr Server ohne Weiterleitung auf https://.
- Fix: Kein Handlungsbedarf bei der Verschlüsselung selbst. Zur fehlenden Weiterleitung siehe den Punkt „Keine Weiterleitung von http:// auf https://“.
- Used when: the address was entered with http://, the homepage stayed on http://, and one request to its https:// address got an answer (Prüfmaße row "Verschlüsselung": erfüllt). The missing redirect is its own finding (`security-http-no-redirect`). New in session fix-a2.
- Status: Entwurf

### `security-http-redirect-ok`

- Title: Weiterleitung von http:// auf https://
- Fact and risk: Wer Ihre Adresse mit http:// aufruft, landet automatisch auf einer verschlüsselten Adresse mit https://.
- Fix: Kein Handlungsbedarf.
- Used when: the http:// address answers with redirects (at most 5) that end on any https:// address; the check does not require the target to be the same site.
- Status: Entwurf

### `security-http-no-redirect`

- Title: Keine Weiterleitung von http:// auf https://
- Fact and risk: Unter http:// antwortet Ihr Server mit einer Seite statt mit einer Weiterleitung auf https://. Wer einem alten Link mit http:// folgt, kann je nach Browser auf der unverschlüsselten Fassung landen.
- Fix: Richten Sie für alle Seiten eine dauerhafte Weiterleitung (Statuscode 301) von http:// auf https:// ein. Bei vielen Hostern ist das eine Einstellung im Kundenbereich.
- Used when: the http:// address answers with a page (status 2xx) instead of a redirect to https://, the page was read to its end or at least to the end of its head (64 KB are read), and it holds neither a refresh nor an inline script that switches the address to https. The first sentence was rewritten in session fix-a2 to state only what the server answered: a redirect that an external script makes later is not seen by the check.
- Status: Entwurf

### `security-http-redirect-in-page`

- Title: Weiterleitung auf https:// erst im Browser
- Fact and risk: Unter http:// antwortet Ihr Server mit einer Seite, die den Browser erst danach auf https:// weiterleitet (per Meta-Refresh oder Refresh-Kopfzeile). Besucher landen so auf der verschlüsselten Adresse. Der erste Aufruf läuft aber unverschlüsselt, und Programme, die solche Weiterleitungen nicht ausführen, bleiben auf der unverschlüsselten Fassung.
- Fix: Nötig ist hier nichts. Sauberer ist eine dauerhafte Weiterleitung des Servers (Statuscode 301) von http:// auf https://; bei vielen Hostern ist das eine Einstellung im Kundenbereich.
- Used when: the http:// address answers with a page (status 2xx) whose `Refresh` header or meta refresh names an https:// address. A neutral note, not a finding; it lowers no count. New in session fix-a2.
- Status: Entwurf

### `security-http-redirect-manual`

- Title: Weiterleitung auf https://: bitte manuell prüfen
- Fact and risk: Wir konnten nicht feststellen, ob Ihre Adresse mit http:// auf https:// weiterleitet (Grund: {reason}). Das ist kein Fund, sondern eine offene Frage.
- Fix: Bitte manuell prüfen: Sehen Sie in den Einstellungen Ihres Hosters nach oder fragen Sie ihn, ob eine Weiterleitung auf https:// eingerichtet ist. Ein Test im eigenen Browser sagt wenig, weil manche Browser von sich aus auf https:// wechseln.
- Used when: the http:// check gives no clear answer; `{reason}` is one of "keine Antwort innerhalb von 10 Sekunden", "Fehlerseite mit Status {status}", "mehr als 5 Weiterleitungen", "Weiterleitung auf eine Adresse, die wir aus Sicherheitsgründen nicht aufrufen", "Weiterleitung ohne Zieladresse", and since session fix-a2 "die Seite unter http:// enthält ein Skript, das die Adresse auf https:// umstellen kann; ob es das tut, zeigt nur ein Browser" "die Seite unter http:// leitet auf eine weitere Adresse mit http:// weiter, die wir nicht geprüft haben" and "die Seite unter http:// wurde nicht vollständig übertragen oder ihr Kopfbereich ist länger als der geprüfte Anfang". Since session fix-a6 the report carries `params.reason` and `params.status`; the phrases by code: `timeout` "keine Antwort innerhalb von 10 Sekunden", `http-error` "Fehlerseite mit Status {status}", `too-many-redirects` "mehr als 5 Weiterleitungen", `not-allowed` "Weiterleitung auf eine Adresse, die wir aus Sicherheitsgründen nicht aufrufen", `no-location` "Weiterleitung ohne Zieladresse", `script-may-redirect`, `refresh-to-http` and `page-not-read` the three phrases of fix-a2 above, new `final-http` "die Adresse mit http:// leitet auf https:// weiter, die Seite endete im Browser aber wieder unter http://", `unknown` "das Ergebnis der Prüfung war nicht eindeutig".
- Status: Entwurf

### `security-http-unavailable`

- Title: Unter http:// nicht erreichbar
- Fact and risk: Unter http:// haben wir von Ihrem Server keine Antwort bekommen; die Verbindung wurde abgelehnt oder abgebrochen. Nimmt Ihr Server unter http:// tatsächlich keine Verbindungen an, ist das keine Schwachstelle: Unverschlüsselt lässt sich Ihre Seite dann gar nicht aufrufen.
- Fix: Nötig ist hier nichts. Wenn Besucher mit alten http://-Links nicht auf einer Fehlermeldung landen sollen, können Sie eine Weiterleitung auf https:// einrichten.
- Used when: the connection to port 80 is refused or broken off while https:// works. A neutral note, not a finding; it lowers no count.
- Status: Entwurf

### `security-header-hsts-missing`

- Title: Strict-Transport-Security nicht gesetzt
- Fact and risk: Ihre Seite wird ohne den Header Strict-Transport-Security (HSTS) ausgeliefert. Mit ihm merkt sich der Browser, Ihre Seite nur noch über HTTPS aufzurufen; ohne ihn kann jemand im selben Netz, etwa in einem öffentlichen WLAN, einen unverschlüsselten Aufruf über http:// abfangen und umlenken.
- Fix: Senden Sie den Header mit jeder HTTPS-Antwort, zum Beispiel Strict-Transport-Security: max-age=31536000 (ein Jahr); über http:// gesendet, beachtet ihn der Browser nicht. Wenn Sie unsicher sind, beginnen Sie mit einer kurzen Laufzeit, etwa max-age=86400 (ein Tag), und erhöhen Sie sie später. Den Zusatz includeSubDomains setzen Sie nur, wenn alle Subdomains HTTPS haben.
- Used when: the page is delivered over HTTPS without the header. On a page without HTTPS no HSTS text is shown, only `security-https-missing`, because HSTS needs HTTPS first.
- Status: Entwurf

### `security-header-hsts-invalid`

- Title: Strict-Transport-Security ohne Wirkung
- Fact and risk: Ihre Seite sendet den Header Strict-Transport-Security mit max-age=0. Damit schaltet sie den Schutz ausdrücklich ab.
- Fix: Senden Sie den Header in der HTTPS-Antwort mit einer Laufzeit in Sekunden, zum Beispiel max-age=31536000 für ein Jahr.
- Used when: the page is delivered over HTTPS and the header has max-age=0, and only then. On a page without HTTPS no HSTS text is shown. A short but positive max-age is valid and is not reported.
- Status: Entwurf

### `security-header-hsts-no-max-age`

- Title: Strict-Transport-Security ohne gültige Laufzeit
- Fact and risk: Im Header Strict-Transport-Security steht keine gültige Angabe max-age: „{value}“. Ohne sie wirkt der Header nicht.
- Fix: Ergänzen Sie eine Laufzeit in Sekunden in der Form max-age=Zahl, zum Beispiel Strict-Transport-Security: max-age=31536000 für ein Jahr.
- Used when: the page is delivered over HTTPS and the header is present, but max-age is missing or not a whole number (RFC 6797 requires max-age); `{value}` is the first header value. On a page without HTTPS no HSTS text is shown.
- Status: Entwurf

### `security-header-csp-missing`

- Title: Content-Security-Policy nicht gesetzt
- Fact and risk: Ihre Seite wird ohne den Header Content-Security-Policy ausgeliefert. Mit ihm legen Sie fest, aus welchen Quellen der Browser Skripte und andere Inhalte laden darf; ohne ihn gibt es diese Grenze nicht, auch nicht für fremden Code, der etwa über eine Sicherheitslücke in einem Plugin Ihres Systems in die Seite gelangt.
- Fix: Legen Sie eine Richtlinie an, die nur die Quellen erlaubt, die Ihre Seite wirklich nutzt. Testen Sie sie zuerst als Content-Security-Policy-Report-Only, dann sehen Sie, was blockiert würde, ohne dass etwas kaputtgeht.
- Used when: there is neither a Content-Security-Policy header nor a meta element with it, and no Report-Only header (that case uses `security-header-csp-report-only`).
- Status: Entwurf

### `security-header-csp-invalid`

- Title: Content-Security-Policy mit Fehlern
- Fact and risk: Ihre Seite legt eine Content-Security-Policy fest, aber diese Teile verstehen aktuelle Browser nicht: „{value}“. Sie werden ignoriert und schützen daher nicht.
- Fix: Prüfen Sie die Schreibweise, zum Beispiel script-src statt script-scr, und trennen Sie die Anweisungen mit Semikolon. Die Konsole in den Entwicklerwerkzeugen des Browsers zeigt, was er nicht versteht.
- Used when: since session fix-a6 for a policy (header or meta) without any directive, only separators such as ";" (`{value}` is the value as received); not yet for directives or source values that browsers do not recognise. An empty value counts as missing.
- Status: Entwurf

### `security-header-csp-report-only`

- Title: Content-Security-Policy nur im Testmodus
- Fact and risk: Ihre Seite sendet nur den Header Content-Security-Policy-Report-Only. Damit meldet der Browser, was er blockieren würde, blockiert aber nichts.
- Fix: Wenn die Meldungen keine Probleme mehr zeigen, senden Sie dieselbe Richtlinie als Content-Security-Policy. Den Testmodus können Sie für spätere Änderungen daneben behalten.
- Used when: only Content-Security-Policy-Report-Only is set and no enforcing policy (header or meta); counts as not present in the Prüfmaße.
- Status: Entwurf

### `security-header-csp-manual`

- Title: Content-Security-Policy: bitte manuell prüfen
- Fact and risk: Ihre Seite sendet keinen Header Content-Security-Policy. Ob die Regeln stattdessen in einem meta-Element der Seite stehen, konnten wir diesmal nicht lesen.
- Fix: Bitte manuell prüfen: Suchen Sie im Quelltext der Startseite nach `<meta http-equiv="Content-Security-Policy"`.
- Used when: no CSP header and the page's meta tags were not read (no page snapshot, or a capture made before A3); counts neither as present nor as missing.
- Status: Entwurf

### `security-header-csp-meta`

- Title: Content-Security-Policy im Quelltext statt im Header
- Fact and risk: Ihre Seite legt die Content-Security-Policy mit einem meta-Element im Quelltext fest, nicht als HTTP-Header. Das werten wir als vorhanden; einige Anweisungen wie frame-ancestors wirken auf diesem Weg allerdings nicht.
- Fix: Wenn Ihr Hoster es erlaubt, senden Sie die Richtlinie als HTTP-Header. Sonst setzen Sie das meta-Element möglichst weit oben in den head, denn es gilt erst ab seiner Stelle.
- Used when: `<meta http-equiv="Content-Security-Policy">` is found and the header is not set; counts as present, shown as a hint, not as a finding.
- Status: Entwurf

### `security-header-xcto-missing`

- Title: X-Content-Type-Options nicht gesetzt
- Fact and risk: Ihre Seite wird ohne den Header X-Content-Type-Options ausgeliefert. Ohne ihn darf der Browser bei manchen Dateien selbst raten, welcher Typ es ist, statt der Angabe Ihres Servers zu folgen; das kann Angriffe erleichtern, bei denen eine Datei als Skript ausgeführt wird.
- Fix: Senden Sie den Header X-Content-Type-Options: nosniff. Er stört nichts, solange Ihr Server Skripte und Stylesheets mit dem richtigen Typ ausliefert.
- Used when: the main document response has no X-Content-Type-Options header.
- Status: Entwurf

### `security-header-xcto-invalid`

- Title: X-Content-Type-Options mit falschem Wert
- Fact and risk: Ihre Seite sendet den Header X-Content-Type-Options mit dem Wert „{value}“. Der Browser kennt nur den Wert nosniff und beachtet den Header sonst nicht.
- Fix: Setzen Sie den Wert genau auf nosniff: X-Content-Type-Options: nosniff.
- Used when: the header is present but its first value is not "nosniff" (compared without regard to case).
- Status: Entwurf

### `security-header-referrer-policy-missing`

- Title: Referrer-Policy nicht gesetzt
- Fact and risk: Ihre Seite wird ohne den Header Referrer-Policy ausgeliefert, der regelt, wie viel von Ihrer Adresse andere Server beim Laden von Inhalten oder beim Klick auf einen Link erfahren. Aktuelle Browser nutzen ohne ihn die sparsame Voreinstellung strict-origin-when-cross-origin: Fremde Server sehen höchstens Ihre Domain, nicht die einzelne Seite. Das Risiko ist daher gering.
- Fix: Setzen Sie den Header trotzdem ausdrücklich, zum Beispiel Referrer-Policy: strict-origin-when-cross-origin. Dann hängt das Verhalten nicht von der Voreinstellung des einzelnen Browsers ab.
- Used when: neither the header nor a `<meta name="referrer">` with a recognised value is set; low priority.
- Status: Entwurf

### `security-header-referrer-policy-invalid`

- Title: Referrer-Policy mit unbekanntem Wert
- Fact and risk: Ihre Seite sendet den Header Referrer-Policy mit dem Wert „{value}“, den der Browser nicht kennt. Er ignoriert diesen Wert. Ist auch kein meta-Element gesetzt, nutzt er seine Voreinstellung, in aktuellen Browsern strict-origin-when-cross-origin. Das Risiko ist gering.
- Fix: Verwenden Sie einen der festgelegten Werte, zum Beispiel strict-origin-when-cross-origin oder no-referrer. Im Header dürfen mehrere Werte mit Komma getrennt stehen; der Browser nimmt den letzten, den er kennt.
- Used when: the header contains no value that browsers recognise and there is no meta element with a recognised value; low priority.
- Status: Entwurf

### `security-header-referrer-policy-manual`

- Title: Referrer-Policy: bitte manuell prüfen
- Fact and risk: Ihre Seite sendet keinen verwendbaren Header Referrer-Policy. Ob die Regel stattdessen in einem meta-Element der Seite steht, konnten wir diesmal nicht lesen.
- Fix: Bitte manuell prüfen: Suchen Sie im Quelltext der Startseite nach `<meta name="referrer"`.
- Used when: no Referrer-Policy header with a known value and the page's meta tags were not read; counts neither as present nor as missing.
- Status: Entwurf

### `security-header-referrer-policy-meta`

- Title: Referrer-Policy im Quelltext statt im Header
- Fact and risk: Ihre Seite legt die Referrer-Policy mit einem meta-Element im Quelltext fest, nicht als HTTP-Header. Das werten wir als vorhanden, der Browser beachtet beide Wege.
- Fix: Kein Handlungsbedarf. Wenn Sie später auch den Header setzen, verwenden Sie denselben Wert, damit sich beide Angaben nicht widersprechen.
- Used when: `<meta name="referrer">` with a recognised value is found and the header is not set or has no recognised value; counts as present, shown as a hint. Recognised in meta are the header values and the old values never, default, always and origin-when-crossorigin, which the HTML standard still accepts there.
- Status: Entwurf

### `security-header-permissions-policy-missing`

- Title: Permissions-Policy nicht gesetzt
- Fact and risk: Ihre Seite wird ohne den Header Permissions-Policy ausgeliefert, mit dem Sie Browserfunktionen wie Kamera, Mikrofon oder Standort für Ihre Seite und eingebettete Inhalte abschalten können. Der Header wirkt in Chrome, Edge und anderen Chromium-Browsern. Ohne ihn gelten die Voreinstellungen des Browsers; für diese drei Funktionen fragt er den Besucher ohnehin um Erlaubnis, der Header ist eine zusätzliche Absicherung.
- Fix: Senden Sie den Header und schalten Sie ab, was Ihre Seite nicht nutzt, zum Beispiel Permissions-Policy: camera=(), microphone=(), geolocation=().
- Used when: neither Permissions-Policy nor Feature-Policy is set (only Feature-Policy uses `security-header-permissions-policy-legacy`); low priority.
- Status: Entwurf

### `security-header-permissions-policy-invalid`

- Title: Permissions-Policy fehlerhaft geschrieben
- Fact and risk: Ihre Seite sendet den Header Permissions-Policy, aber nicht in der Schreibweise, die der Browser erwartet: „{value}“. Der Browser ignoriert den Header dann ganz oder teilweise.
- Fix: Schreiben Sie jede Funktion in der Form Name=Wert, zum Beispiel camera=() für „nirgends erlaubt“, geolocation=(self) für „nur Ihre eigene Seite“ oder fullscreen=* für „überall erlaubt“, und trennen Sie die Einträge mit Komma.
- Used when: the value does not parse as a structured field, so Chromium drops the whole header (semicolons instead of commas, single-quoted 'self', old Feature-Policy syntax such as `camera 'none'`, no '='), or it names only retired features such as `interest-cohort` (the old FLoC opt-out), which restrict nothing.
- Status: Entwurf

### `security-header-permissions-policy-legacy`

- Title: Nur der veraltete Header Feature-Policy
- Fact and risk: Ihre Seite sendet nur den älteren Header Feature-Policy. Er wurde in Permissions-Policy umbenannt und gilt als veraltet; verlassen Sie sich nicht darauf, dass Browser ihn weiter beachten.
- Fix: Senden Sie stattdessen Permissions-Policy. Die Schreibweise ist neu: Aus camera 'none' wird camera=().
- Used when: Feature-Policy is set and Permissions-Policy is not. Whether it counts as present in the Prüfmaße is decided in the analyzer; the text works either way.
- Status: Entwurf

## Mandatory information

Written in session A5 (22.11.2026) after Fedor's answers to the questions of A4 (`docs/decisions.md`). How the report shows them is decided in B3. Like every text in this file, they are drafts.

### `legal-impressum-no-link`

- Title: Impressum-Link nicht gefunden, bitte manuell prüfen (Fedor's wording, 22.11.2026)
- Fact and risk: Auf der Startseite haben wir keinen Link gefunden, der zum Impressum führt. Er kann in einem Menü stecken, das sich erst nach einem Klick öffnet, und unsere Prüfung klickt nichts an. Fehlt der Link wirklich, finden Besucher die Pflichtangaben zum Anbieter nicht, und das kann abgemahnt werden.
- Fix: Setzen Sie einen Link mit dem Text „Impressum“ in den Fußbereich jeder Seite, so dass er ohne weiteren Klick sichtbar ist.
- Used when: `analyzeLegal` gives the Impressum state `no-link` (no link on the homepage whose text or address names the Impressum). This is the only text of the mandatory information with a risk (product rule 3); every field that was not found stays "nicht gefunden, bitte manuell prüfen" without a risk.
- Status: Entwurf

### `legal-accessibility-statement-uncertain`

- Title: Link gefunden, bitte prüfen, ob es die Erklärung ist (Fedor's wording, 22.11.2026)
- Fact and risk: Auf Ihrer Seite gibt es einen Link zum Thema Barrierefreiheit. Ob er zu einer Erklärung zur Barrierefreiheit führt oder zum Beispiel zu einer Leistungsseite, können wir automatisch nicht sicher sagen.
- Fix: Öffnen Sie den Link und prüfen Sie, ob dort die Erklärung zur Barrierefreiheit steht. Wenn nicht und Ihr Angebot unter das BFSG fällt, verlinken Sie die Erklärung an derselben Stelle.
- Used when: the accessibility statement link has `certain: false` (a link that names only the topic, for example "Barrierefreiheit" or "Digitale Barrierefreiheit"). Never shown as "Erklärung vorhanden". Whether the BFSG applies is the visitor's question (BFSG scheme of the design).
- Status: Entwurf

## Unsure results of the scan (session fix-a1)

Written in session fix-a1 (23.11.2026) for three results the report gives when the scan itself is unsure. Like every text in this file, they are drafts; the look is decided in B2 to B4.

### `report-page-almost-empty`

- Text: Die Seite hat bei unserem Besuch fast keinen Inhalt gezeigt. Möglicherweise hat ein Schutz vor automatischen Zugriffen unsere Prüfung nicht durchgelassen. Was wir gesehen haben, kann zu diesem Schutz gehören und nicht zu Ihrer Website. Deshalb zeigen wir keine Befunde, sondern nur Punkte, die Sie bitte manuell prüfen.
- Used when: the report is `complete`, but the page showed at most 1 500 characters of text, 3 links and 15 requests and linked to no Impressum and no Datenschutzerklärung. Such a report has no findings and no hints, and every Prüfmaß that was checked says "bitte manuell prüfen" (session fix-a2; the third and fourth sentence were rewritten then).
- Status: Entwurf

### `third-party-frame-unknown`

- Title: {service}: Herkunft der Anfrage unklar, bitte manuell prüfen
- Fact: Während unseres Besuchs ging eine Anfrage an {service} ({provider}). Wir konnten nicht feststellen, ob Ihre Seite selbst sie ausgelöst hat oder ein eingebetteter Inhalt eines anderen Anbieters, zum Beispiel ein Formular oder ein Video.
- Fix: Prüfen Sie, ob Sie {service} selbst einbinden. Wenn nicht, gehört die Anfrage zu einem eingebetteten Inhalt.
- Used when: a service that would be a finding by its risk class was seen only in requests whose document the capture does not know. A hint without a risk.
- Status: Entwurf

### `legal-impressum-no-link-empty-page`

- Title: Impressum-Link nicht gefunden, bitte manuell prüfen
- Fact: Die Seite hat bei unserem Besuch fast keinen Inhalt gezeigt, auch keinen Link zum Impressum. Das sagt nichts darüber aus, ob der Link auf Ihrer Website vorhanden ist.
- Fix: Öffnen Sie Ihre Startseite in einem Browser und prüfen Sie, ob der Link „Impressum“ ohne weiteren Klick sichtbar ist.
- Used when: the Impressum state is `no-link` on a page with the notice `report-page-almost-empty` (or its quick-check variant). Without a risk, unlike `legal-impressum-no-link`.
- Status: Entwurf

## Quick check (session fix-a2)

Written in session fix-a2 (23.11.2026). Like every text in this file, a draft.

### `legal-impressum-no-link-quick`

- Title: Impressum-Link im HTML-Quelltext nicht gefunden, bitte manuell prüfen
- Fact: Die Schnellprüfung liest nur den HTML-Quelltext Ihrer Startseite, ohne Browser. Darin steht kein Link zum Impressum. Baut erst ein Skript das Menü oder die Fußzeile im Browser auf, kann die Schnellprüfung den Link nicht sehen. Das sagt deshalb nichts darüber aus, ob der Link auf Ihrer Website vorhanden ist.
- Fix: Bitte manuell prüfen: Öffnen Sie Ihre Startseite in einem Browser und sehen Sie nach, ob der Link „Impressum“ ohne weiteren Klick sichtbar ist. Die vollständige Prüfung mit Browser ist morgen wieder möglich.
- Used when: the report is a quick check (`state: quick`) and the HTML source of the homepage holds no link to an Impressum. A manual check without a risk, never in "Drei Dinge", unlike `legal-impressum-no-link` of the full check.
- Status: Entwurf

## Legal links (session fix-a3)

Written in session fix-a3 (24.11.2026). Like every text in this file, a draft.

### `legal-datenschutz-uncertain`

- Title: Link zum Datenschutz gefunden, bitte prüfen, ob er zu Ihrer Datenschutzerklärung führt
- Fact, reason `other-site`: Auf Ihrer Startseite führt ein Link mit dem Wort „Datenschutz“ auf eine andere Website. Das kann Ihre eigene Datenschutzerklärung sein, die an anderer Stelle liegt, oder die Datenschutzhinweise eines Dienstes, den Sie einbinden. Einen Link zu einer Datenschutzerklärung auf Ihrer eigenen Website haben wir nicht gefunden.
- Fact, reason `same-page`: Auf Ihrer Startseite führt ein Link mit dem Wort „Datenschutz“ zu einer Stelle derselben Seite. Das kann ein Abschnitt mit Ihrer Datenschutzerklärung sein oder die Schaltfläche, die die Cookie-Einstellungen öffnet. Einen Link zu einer eigenen Seite mit der Datenschutzerklärung haben wir nicht gefunden.
- Fix: Bitte manuell prüfen: Öffnen Sie den Link. Steht dort die Datenschutzerklärung Ihrer Website, ist nichts zu tun. Wenn nicht, verlinken Sie Ihre Datenschutzerklärung gut sichtbar, zum Beispiel in der Fußzeile.
- Used when: the only link the scan finds for the Datenschutzerklärung leads to another registrable domain (`params.reason` `other-site`) or is an anchor of the homepage itself (`same-page`). A manual check without a risk. The report then shows no `datenschutzLink`. New in session fix-a3 (review finding 14).
- Status: Entwurf

## Limits of the scan (session fix-a4)

German drafts for what the report says when a limit of the scan was reached. All of them are drafts.

### `report-failed` with `reason: page-limit`

- Title: Prüfung abgebrochen: Die Seite ist größer, als die Prüfung aufzeichnet
- Fact: Ihre Startseite hat während des Besuchs mehr als 2 000 Anfragen gestellt oder mehr Daten geliefert, als die Prüfung aufzeichnet. Wir haben den Besuch an dieser Grenze beendet. Aus einem Teil der Seite ziehen wir keine Schlüsse, deshalb zeigt dieser Bericht keine Funde.
- Fix: Bitte manuell prüfen. Eine gewöhnliche Startseite stellt einige Dutzend bis einige Hundert Anfragen. Lädt Ihre Seite ständig nach, zum Beispiel durch ein Skript in einer Schleife, hilft ein Blick in die Netzwerkanalyse des Browsers.
- Used when: the notice `report-failed` has `params.reason` `page-limit` (`failure.reason` is `page-limit` too): more than 2,000 requests, more than 500,000 characters of request addresses, or a capture larger than 2 MB.
- Status: Entwurf

### `legal-impressum-no-link-links-cut`

- Title: Impressum-Link nicht gefunden, bitte manuell prüfen
- Fact: Die Prüfung hat nicht alle Links Ihrer Startseite gelesen: Die Seite hat mehr Links, als die Prüfung liest, oder einzelne Links haben eine ungewöhnlich lange Adresse. Unter den gelesenen Links ist kein Link zum Impressum. Er kann unter den übrigen sein.
- Fix: Bitte manuell prüfen: Ist der Link „Impressum“ auf Ihrer Startseite ohne weiteren Klick sichtbar?
- Used when: no Impressum link was found and `truncated.page` contains `homepage-links`. A manual check without a risk, never in "Drei Dinge".
- Status: Entwurf

### `security-header-too-long`

- Title: Header gesendet, Wert zu lang für die Prüfung, bitte manuell prüfen
- Fact: Ihr Server sendet diesen Header, sein Wert ist aber länger als 16 000 Zeichen. Einen so langen Wert wertet die Prüfung nicht aus. Der Header zählt deshalb weder als vorhanden noch als fehlend.
- Fix: Bitte manuell prüfen, ob der Wert so gewollt ist. Übliche Werte dieses Headers sind wenige Zeilen lang.
- Used when: a security header (or its older form) is named in the capture's `headersCut`; the header row has the status `manual`, and `truncated.page` contains `headers`.
- Status: Entwurf

### `section-not-analysed`

- Title: Dieser Teil der Prüfung konnte nicht ausgewertet werden
- Fact: Bei der Auswertung dieses Teils ist bei uns ein Fehler aufgetreten. Die übrigen Teile des Berichts sind davon nicht betroffen.
- Fix: Starten Sie die Prüfung später noch einmal.
- Used when: an analysis threw (`sections.<part>` is `not-checked` with the reason `analyzer-error`); `params.section` names the part.
- Status: Entwurf

### `report-truncated-findings`, `report-truncated-services`

- Text (findings): Die Liste zeigt die wichtigsten {shown} von {total} Einträgen.
- Text (services): Die Stückliste zeigt {shown} von {total} Diensten.
- Used when: `truncated.findings` or `truncated.services` is true; `total` comes from `counts`.
- Status: Entwurf

### `report-truncated-page`

- Text (`homepage-text`): Die Startseite hat mehr Text, als die Prüfung liest (100 000 Zeichen). Der Rest wurde nicht gelesen.
- Text (`homepage-links`): Die Startseite hat Links, die die Prüfung nicht gelesen hat (mehr als 1 500 Links oder ungewöhnlich lange Adressen).
- Text (`impressum-text`): Das Impressum hat mehr Text, als die Prüfung liest (100 000 Zeichen). Der Rest wurde nicht gelesen.
- Text (`impressum-links`): Das Impressum hat Links, die die Prüfung nicht gelesen hat.
- Text (`headers`): Ein Header der Startseite hat einen Wert, der für die Prüfung zu lang ist. Er wurde nicht ausgewertet.
- Used when: `truncated.page` names the part.
- Status: Entwurf

## Session fix-a6

### `security-header-referrer-policy-weak`

- Title: Referrer-Policy schwächer als die Voreinstellung
- Fact and risk: Ihre Seite legt die Referrer-Policy „{value}“ fest. Damit erfahren andere Server beim Laden von Inhalten und beim Klick auf einen Link die vollständige Adresse der Seite, mehr als mit der Voreinstellung aktueller Browser (strict-origin-when-cross-origin), bei der sie höchstens Ihre Domain sehen. Wir werten den Header deshalb nicht als vorhanden. Das Risiko ist gering.
- Fix: Setzen Sie Referrer-Policy: strict-origin-when-cross-origin oder einen strengeren Wert wie same-origin oder no-referrer. Prüfen Sie auch ein meta-Element name="referrer" im Quelltext: Es gilt nach dem Header.
- Used when: the effective policy (the last known token of the header, or a meta element with a known value, which is applied after the header) is `unsafe-url` (also the old meta value `always`) or `no-referrer-when-downgrade`; does not count in "{n} von 5"; low priority.
- Status: Entwurf

### `security-header-permissions-policy-open`

- Title: Permissions-Policy erlaubt alles
- Fact and risk: Ihre Seite sendet den Header Permissions-Policy, erlaubt darin aber jede genannte Funktion für jede Herkunft: „{value}“. So schränkt der Header nichts ein. Wir werten ihn deshalb nicht als vorhanden.
- Fix: Schalten Sie ab, was Ihre Seite nicht nutzt, zum Beispiel Permissions-Policy: camera=(), microphone=(), geolocation=(). Erlauben Sie eine Funktion nur dort, wo sie gebraucht wird, etwa geolocation=(self).
- Used when: every feature of the header that browsers still know has an allowlist with `*` (`camera=*` or `camera=(*)`); does not count in "{n} von 5".
- Status: Entwurf

### `security-header-hsts-duplicate`

- Title: Strict-Transport-Security mit doppelter Angabe
- Fact and risk: Im Header Strict-Transport-Security steht eine Angabe zweimal: „{value}“. Browser ignorieren einen solchen Header ganz, der Schutz wirkt also nicht.
- Fix: Nennen Sie jede Angabe nur einmal, zum Beispiel Strict-Transport-Security: max-age=31536000; includeSubDomains.
- Used when: the page is delivered over HTTPS and the first header value repeats a directive (RFC 6797 allows each only once); does not count in "{n} von 5".
- Status: Entwurf

### `a11y-frame-not-checked`

- Title: Inhalt im Frame nicht geprüft
- Fact and risk: Ein eingebetteter Bereich (iframe) nimmt {share} % des ersten Bildschirms Ihrer Startseite ein. Was darin angezeigt wird, haben wir nicht geprüft; die Prüfung der Barrierefreiheit gilt nur für den Rest der Seite.
- Fix: Bitte manuell prüfen: Öffnen Sie die Adresse des eingebetteten Bereichs direkt oder prüfen Sie ihn mit einem Werkzeug wie WAVE oder Lighthouse. Stammt er von einem Anbieter (Buchung, Karte, Shop), fragen Sie dort nach seiner Barrierefreiheit.
- Used when: the largest iframe covers at least half of the first screen (`a11y:frame-content`); the rows "Kleinster Textkontrast" and "Bilder mit Beschreibung" are then "bitte manuell prüfen" instead of "erfüllt".
- Status: Entwurf

### `report-page-still-loading`

- Title: (a line of the head, no title)
- Text: Ihre Startseite lud nach 15 Sekunden noch weitere Inhalte. Der Bericht zeigt, was bis dahin geladen war; später geladene Inhalte und Dienste sind nicht enthalten.
- Used when: `scan.stopReason` is `max-wait` on a `complete` report.
- Status: Entwurf

### Reason `not-html` of `report-failed`

- Phrase: "Unter der Adresse liegt keine Webseite, sondern eine Datei (zum Beispiel PDF, Bild oder Daten)."
- Used when: `failure.reason` is `not-html` (the main document has a content type other than HTML); the text `report-failed` itself is written in B3.
- Status: Entwurf

## Session B2 part 1

### Title of the scan screen

- Text: Prüfung läuft, Website-Check DE
- Used when: the `<title>` of the scan screen (in part 1 only on the example page of the checks, `/pruefung/beispiel`). The reference has "Prüfung läuft, Bauplan", where "Bauplan" is the name of the design; the home page has "Website-Check DE". Since part 2 also the title of the real scan screen `/pruefung?id=…`.
- Status: Entwurf

## Session B2 part 2

All texts of the real scan screen and of the form live in `web/lib/scan-texts.ts`. Texts marked "final" there are those of `design/reference/pruefung.html`; everything below is a draft. Values of the scanned site or of the visitor (the address, unknown service names, the place of the Impressum) are never part of a template: the page shows them as text of their own in `<bdi>`.

### Heading before the address is known

- Text: Ihre Website wird nachgemessen
- Used when: the scan screen has loaded but neither the form nor the API has named the address yet (a fraction of a second, or a link opened in a new tab until the first answer). The reference: "{domain} wird nachgemessen".
- Status: Entwurf

### Rows of the "Messprotokoll" while they wait for the report

- Texts, in the order of the rows: Seite aufrufen · Anfragen aufzeichnen · Einwilligungsbanner suchen · Fremde Dienste vor der Einwilligung prüfen · Impressum suchen · Pflichtangaben lesen · Barrierefreiheit prüfen · Verschlüsselung und Sicherheits-Header lesen
- Used when: the scan waits in the queue or runs; the rows name what the scan does, never a result, no number (Fedor, B2 part 2, answer 1). Shown dimmed at a contrast of at least 4.5:1, without a tick. A row whose part the report did not check stays like this after the report (part 3 gives it a state).
- Status: Entwurf

### Rows with the report: variants not in the reference

- "1 Anfrage aufgezeichnet" (singular of "{n} Anfragen aufgezeichnet"); "Anfragen aufgezeichnet" without a number for a report made before the count existed.
- "keine an fremde Server" (for "davon {n} an fremde Server" with 0); "davon 1 an einen fremden Server" (with 1).
- "Kein Einwilligungsbanner erkannt" (no banner seen; never a finding by itself).
- "1 fremder Dienst vor der Einwilligung" (singular); "Keine Funde bei fremden Diensten" (no service is a finding; tick instead of "!"; requests to third parties such as public CDNs may still be counted in the row above); after three names "und 1 weiterer" or "und {n} weitere".
- "Impressum-Link nicht gefunden" with the line "bitte manuell prüfen" (red "!", the manual check with a high risk; wording as `legal-impressum-no-link`).
- "USt-IdNr." as the fourth name in the line of "Pflichtangaben gelesen" (the reference lists "Anschrift, E-Mail, Handelsregister"); "keine gefunden, bitte manuell prüfen" when no field was found.
- Status: Entwurf

### Summary under "Fertig. Ihr Bericht ist gezeichnet."

- Pattern (final in the reference for 7 and 3): "{n} Funde, davon {p} vorrangig. Zu jedem gibt es eine Anleitung für {System}."
- Drafts: "1 Fund" (singular); "Keine Funde."; ", davon {p} vorrangig" left out when no priority is a finding; "1 Punkt bitte manuell prüfen." or "{m} Punkte bitte manuell prüfen." when the report has manual checks; "Dazu gibt es eine Anleitung für {System}." for one finding. The sentence about the instructions only when the system is known and every finding names its instructions (B4 writes them).
- "Der Bericht zeigt, was wir prüfen konnten." for a report that is not a complete check (quick check, blocked, refused, failed, almost empty page) until part 3 builds those states.
- Status: Entwurf

### Text description of the drawing (aria-label)

- While waiting: Der Plotter zeichnet die Startseite, die wir prüfen.
- With the report (B2 part 3, Fedor's answer 1): "Der Plotter zeichnet die geprüfte Startseite." when no priority has a place on the drawing; otherwise "Der Plotter zeichnet die geprüfte Startseite und markiert rot, wo vorrangige Punkte liegen: {Liste}.", where each placed priority is "Punkt {n} in Feld {Feld}" (its measured field, B2, A2 or A3) or "Punkt {n} im Quelltext" (a request made by the page's own code, or the language of the page), joined by ", " and " und ". A priority without a place is not named. The reference names the parts of the drawing ("Überschrift, Quelltext am Seitenende und Unterzeile"); the real text names the field, because the drawing is a sketch, not the visitor's page.
- Status: Entwurf

### Status line (role="status")

- In the queue: "Ihre Prüfung wartet: Platz {n} in der Warteschlange." (without a known place: "Ihre Prüfung wartet in der Warteschlange.")
- Running: "Die Messung läuft."
- Ready: "Die Messung ist fertig. Der Bericht ist bereit."
- Used when: the status region of the scan screen; a text only when the state changes (Fedor, B2 part 2, answer 3). Visible under the lead text in the cyan of "Startseite und Impressum".
- Status: Entwurf

### Temporary messages of part 2

- Removed in part 3 (24.11.2026): "Das hat nicht geklappt. Bitte versuchen Sie es später noch einmal." (scan screen) and "Das hat nicht geklappt. Bitte prüfen Sie die Adresse und versuchen Sie es noch einmal." (form). The states of part 3 below replace them.
- Status: ersetzt

## Session B2 part 3

The states that the design does not show, built only from elements of the reference (Fedor, B2 part 3). All texts live in `web/lib/scan-texts.ts`; every one of them is a draft. Each state opens at an address of its own in `npm run preview:examples`: the scan screen at `/pruefung/beispiel/<state>`, the form at `/beispiel/formular/<state>`. "Keine Funde bei fremden Diensten" (part 2) stays a draft (Fedor, B2 part 3, answer 3).

### Form of the home page: a refused start

Shown under "Website prüfen" in the light red of the marks, in a region with `role="alert"` that is there from the first paint and tied to the field (`aria-describedby`; `aria-invalid` only when the address is the problem); the focus goes back to the field. `{wann}` is the moment of `Retry-After`, rounded up to the next full minute, in the visitor's own time: "ab 14:25 Uhr" (today), "morgen ab 01:00 Uhr", "am 27.11. ab 14:04 Uhr"; "später" when the answer names no time.

- Empty field: Bitte geben Sie die Adresse Ihrer Website ein, zum Beispiel ihre-website.de.
- 400 `invalid-address`: Das ist keine Web-Adresse, die wir prüfen können. Bitte geben Sie sie so ein: ihre-website.de.
- 400 `address-not-found`: Zu dieser Adresse finden wir keinen Server. Bitte prüfen Sie die Schreibweise.
- 400 `address-not-allowed`, by its rule: `scheme` "Wir prüfen nur Adressen, die mit http:// oder https:// beginnen."; `credentials` "Bitte geben Sie die Adresse ohne Benutzernamen und Passwort ein."; `port` "Wir prüfen nur Websites auf den üblichen Ports. Bitte geben Sie die Adresse ohne Portnummer ein."; `host-name` "Diese Adresse ist nicht öffentlich erreichbar. Wir prüfen nur öffentliche Websites."; `address` "Diese Adresse führt zu keinem öffentlichen Server. Wir prüfen nur öffentliche Websites."; any other "Diese Adresse können wir nicht prüfen. Wir prüfen nur öffentliche Websites."
- 429 `rate-limited`, `limit` `hour`: Sie haben in dieser Stunde so viele Prüfungen gestartet, wie wir einem Besucher erlauben. Die nächste ist {wann} möglich.
- 429 `rate-limited`, `limit` `day`: Sie haben heute so viele Prüfungen gestartet, wie wir einem Besucher an einem Tag erlauben. Die nächste ist {wann} möglich.
- 429 `rate-limited`, `limit` `starts`: Sie haben in kurzer Zeit sehr viele Prüfungen gestartet. Die nächste ist {wann} möglich.
- 503 `daily-limit` ("heute ausgelastet"): Heute sind alle Prüfungen vergeben. Die nächste ist {wann} möglich.
- Our errors (503 `queue-unavailable`, `not-configured`, `dns-unavailable`, any other answer, no answer): Bei uns ist gerade ein Fehler aufgetreten. Bitte versuchen Sie es {wann} noch einmal. (without a time: "… in einigen Minuten noch einmal.")
- The texts name no number of scans, so they stay true when the limits change (`docs/backlog.md`, stage C).
- Status: Entwurf

### Scan screen: rows of the "Messprotokoll" that the report did not check

- A part the report did not check is lit, without a tick: the name of its step ("Barrierefreiheit prüfen") with the line "nicht geprüft", or "nicht geprüft, Schnellprüfung ohne Browser" (quick check), "nicht geprüft, bitte manuell prüfen" (mandatory information when the Impressum page was not read), "nicht geprüft, kein Impressum geöffnet" (no Impressum link).
- Quick check, first row: "Quelltext der Seite gelesen" with "ohne Browser, so wie Ihr Server ihn ausliefert".
- Blocked: "Prüfung blockiert" with "Ihre Website hat unseren Browser nicht durchgelassen" (and "(Antwort {Status})" when there was one); a block met by the quick check without a browser: "Ihre Website hat unsere Abfrage nicht durchgelassen".
- Accessibility when axe could not check one of the six types: "Barrierefreiheit prüfen" with "nicht geprüft, nicht alle Fehlertypen, bitte manuell prüfen".
- Failed: "Seite nicht geladen" with the reason: "sie hat nicht rechtzeitig geantwortet" (timeout), "der Server war nicht erreichbar", "der Server hat mit dem Fehler {Status} geantwortet", "unter dieser Adresse gibt es keine Website", "sie stellt mehr Anfragen oder liefert mehr Daten, als die Prüfung aufzeichnet" (page limit), "unter der Adresse liegt keine Webseite, sondern eine Datei" (not HTML), "bei der Prüfung ist ein Fehler aufgetreten" (other).
- Refused address: "Adresse nicht geprüft" with "wir prüfen nur Adressen mit http:// oder https://", "die Adresse enthält einen Benutzernamen oder ein Passwort", "wir prüfen nur die üblichen Ports 80 und 443", "die Adresse oder eine Weiterleitung führt zu keinem öffentlichen Server", "zu dieser Adresse gibt es keinen Server", "die Seite leitet mehr als fünfmal weiter", "die Adresse ist für die Prüfung nicht zugelassen".
- Services on an almost empty page (tag "manuell prüfen"): "{n} fremde Dienste, bitte manuell prüfen" ("1 fremder Dienst, …") with their names, a tick.
- The Impressum: "Impressum auf der Startseite" with "als Abschnitt, ohne eigene Seite" (an anchor of the homepage, one page asked for); "Impressum gefunden" with "als PDF, das wir nicht lesen", "die Seite ließ sich nicht lesen, bitte manuell prüfen" or "nicht geöffnet, bitte manuell prüfen". "Impressum-Link nicht gefunden" is red with "!" only when the report gives it a risk; on an almost empty page or in a quick check it has a tick.
- Status: Entwurf

### Scan screen: the summary, the status line and the drawing for a report that is not a plain complete check

- Summary of a quick check: "{Funde}. Schnellprüfung ohne Browser. Die vollständige Prüfung ist morgen wieder möglich." (the last sentence is the brief's).
- Almost empty page: "Die Seite hat bei unserem Besuch fast keinen Inhalt gezeigt. Deshalb zeigt der Bericht keine Funde, nur Punkte, die Sie bitte manuell prüfen."
- Blocked: "Ihre Website hat unsere Prüfung blockiert. Deshalb zeigt der Bericht keine Funde." Failed: "Ihre Startseite ließ sich nicht prüfen. Deshalb zeigt der Bericht keine Funde." Refused: "Diese Adresse dürfen wir nicht prüfen. Deshalb zeigt der Bericht keine Funde." All of them keep "Fertig. Ihr Bericht ist gezeichnet." and "Bericht öffnen": the report (B3) explains the state.
- Status line: "Die Schnellprüfung ist fertig. Der Bericht ist bereit."; "Die Prüfung ist beendet: Ihre Website hat sie blockiert. Der Bericht ist bereit."; "Die Prüfung ist beendet: Ihre Startseite ließ sich nicht prüfen. Der Bericht ist bereit."; "Die Prüfung ist beendet: Diese Adresse dürfen wir nicht prüfen. Der Bericht ist bereit."; while several status requests in a row get no answer (the page keeps asking): "Keine Verbindung zu unserem Server. Wir versuchen es weiter."
- Drawing (aria-label) of a scan that measured nothing: "Der Plotter zeichnet eine Startseite ohne Markierungen, denn diese Prüfung hat sie nicht gemessen."
- Status: Entwurf

### Scan screen: a scan that ended without a report

The panel of "Bericht öffnen" with its own heading and line and the button "Neue Prüfung" (to the home page); the header shows "Neue Prüfung" (the outlined link of the report's header in bericht.html) instead of "Prüfung abbrechen"; every row "nicht geprüft"; the status line says the heading of the panel. The page heading is "{Adresse} wurde nicht nachgemessen" ("Ihre Website wurde nicht nachgemessen" without an address, "Prüfung nicht gefunden" for an unknown scan).

- Cancelled by its last visitor, opened later by a link: "Diese Prüfung wurde abgebrochen." / "Sie wurde aus der Warteschlange genommen, bevor sie begann. Deshalb gibt es keinen Bericht."
- The day's cap was reached at its start: "Heute sind alle Prüfungen vergeben." / "Diese Prüfung konnte nicht mehr beginnen. Die nächste ist {wann} möglich." (the next 00:00 UTC in the visitor's time).
- Our error: "Die Prüfung ist bei uns fehlgeschlagen." / "Deshalb gibt es keinen Bericht. Bitte starten Sie eine neue Prüfung." (the review of part 3: "Das liegt nicht an Ihrer Website." claimed more than we know).
- Unknown scan (404, or a broken link): "Diese Prüfung finden wir nicht." / "Der Link ist unvollständig, oder die Prüfung ist nicht mehr gespeichert."
- The report could not be read three times (the scan is done): "Den Bericht können wir gerade nicht anzeigen." / "Die Prüfung ist fertig. Bitte laden Sie diese Seite in einigen Minuten neu." with the button "Neu laden" (this page again); the heading stays "{Adresse} wird nachgemessen" and the rows wait, because the scan did measure.
- Title of the tab (`<title>`): "Prüfung läuft, Website-Check DE" while the scan waits or runs (part 1), "Bericht bereit, Website-Check DE" with the report, "Prüfung beendet, Website-Check DE" after a scan without a report.
- Status: Entwurf

## Session B3 part 1

The upper part of the report (head, Prüfmaße, "Drei Dinge" with the plan, Zeitschnitt A–A). The texts of `design/reference/bericht.html` are final and are not listed; these are the texts the reference does not have (in `web/lib/report-texts.ts`). Every one is an Entwurf.

### Title of the report page

- `<title>`: Prüfbericht, Website-Check DE (the reference: "Prüfbericht, Bauplan").

### Head

- "Geprüfte Seiten" when only the homepage was checked: Startseite.
- "System" when the system was not recognised: unbekannt (the word of the brief).
- "System" for Shopware with a known version: Shopware 5, Shopware 6.

### Prüfmaße

- Ergebnis of a row the scan is unsure about: bitte manuell prüfen (the mark of "teilweise", the dash, in grey). Product rule 3: the accessibility statement the scan did not find is "nicht gefunden" in the column Ist and "bitte manuell prüfen" in the column Ergebnis, never "fehlt" and "nicht erfüllt" as in the reference (Fedor, 23.11.2026, `docs/report-schema.md`, conflict 14).
- Ergebnis of a row that was not checked, and Ist without a value: nicht geprüft (B3 part 2 shows these states).
- Ist of the accessibility statement: nicht gefunden; Link gefunden, bitte prüfen (a link that names only the topic). Ist of the encryption: HTTP, unbekannt.
- A failing contrast is written with one decimal, rounded down (4,47 : 1 is "4,4 : 1"), so it never reads as the required value.

### "Drei Dinge sollten Sie zuerst beheben"

- Title of a finding about a third-party service other than Google Fonts and Google Analytics (the two titles of the reference): {Dienst} startet vor der Einwilligung.
- Title of the finding about the security headers: {n} von {gesamt} Sicherheits-Headern gesetzt.
- The other titles are those of the drafts above (`a11y-*`, `security-https-missing`, `security-http-no-redirect`, `legal-impressum-no-link`).
- A text id without a title: Vorrangiger Punkt (never the id).
- Area: Pflichtangaben (mandatory information), Sicherheit (security); risk: niedriges Risiko (the reference has "Datenschutz", "Barrierefreiheit", "hohes Risiko" and "mittleres Risiko").
- The accessible name of the plan names the marks of the design by their place, as the reference does ("Überschrift in Feld B2", "Quelltext am Seitenende in Feld A3", "Unterzeile in Feld A2"); a code mark without a field (a request made by the page's own code) is "Quelltext am Seitenende". Two priorities at one place share the mark ("1, 2"), and the place is named once.

### Zeitschnitt A–A

- The small line of the site's own files: Ihre Dateien. The reference says "Ihre Dateien: Design und Skripte"; the report does not say which kind of files they are (schema v1 has the row kind `files` only). Since B3 part 2 only for a report made before or files of other types; see "Session B3 part 2".
- The small line of a third-party host without a known provider: fremder Server; of a consent tool loaded from its provider: {Anbieter}, fremder Server (the row label is then its host; the reference's "Einwilligungstool, Ihr Server" is the tool on the site's own server).

## Session B3 part 2

The report page of a real scan (`/bericht?id=…`) and the states of the upper part of the report that the design does not show, built only from elements of `design/reference/bericht.html` (Fedor, B3 part 2). All texts live in `web/lib/report-texts.ts`; every one is an Entwurf. Each state opens at an address of its own in `npm run preview:examples`: `/bericht/beispiel/<state>`.

### The page without a report to show

Built from the head of the report ("Prüfbericht für {domain}" when the address is known), the heading of a section, a paragraph and the outlined link of the sheet (`.gl`, "Arbeitsauftrag für Ihren Entwickler").

- While the report loads: Der Bericht wird geladen.
- The status region of the live page (not shown, read by a screen reader when the content changes): "Der Bericht ist geladen." with the report, otherwise the heading of the state.
- Not ready yet (the scan waits or runs): "Der Bericht ist noch nicht fertig." / "Die Prüfung läuft noch. Auf der Seite der Prüfung sehen Sie, wie weit sie ist, und öffnen den Bericht, sobald er fertig ist." / link "Zur Prüfung" (to `/pruefung?id=…`).
- Ended without a report, cancelled: "Zu dieser Prüfung gibt es keinen Bericht." / "Sie wurde aus der Warteschlange genommen, bevor sie begann." / "Neue Prüfung".
- Ended without a report, the day's cap: "Zu dieser Prüfung gibt es keinen Bericht." / "Sie konnte nicht beginnen, weil an diesem Tag alle Prüfungen vergeben waren." / "Neue Prüfung".
- Ended without a report, our error: "Die Prüfung ist bei uns fehlgeschlagen." / "Deshalb gibt es keinen Bericht. Bitte starten Sie eine neue Prüfung." (the draft of B2 part 3) / "Neue Prüfung".
- Unknown id: "Diesen Bericht finden wir nicht." / "Der Link ist unvollständig, oder der Bericht ist nicht mehr gespeichert." / "Neue Prüfung".
- No usable answer after three tries, or a report that fails the validator: "Den Bericht können wir gerade nicht anzeigen." / "Bitte laden Sie diese Seite in einigen Minuten neu." / "Neu laden" (this page again).
- Status: Entwurf

### Head

- The fifth fact, when the report knows the country of the visit (Fedor, 21.11.2026): "Aufgerufen aus" with the German name of the country ("Deutschland", "Niederlande").
- "System" when the homepage did not load: nicht geprüft (never "unbekannt").
- "Geprüfte Seiten" when the homepage did not load: keine.
- Status: Entwurf

### The note under the head

Built from the dashed box of the "Revisionen" ("So erscheint ein erledigter Fund …"): the small grey label "Hinweis" and one line per point.

- Quick check: Schnellprüfung ohne Browser: Wir haben nur den Quelltext Ihrer Startseite gelesen, so wie Ihr Server ihn ausliefert. Fremde Dienste und Barrierefreiheit sind deshalb nicht geprüft. Die vollständige Prüfung ist morgen wieder möglich. (The last sentence is the brief's.)
- Blocked: Ihre Website hat unseren Browser nicht durchgelassen (Antwort {Status}). Deshalb zeigt der Bericht keine Funde. A block met by the quick check: "… unsere Abfrage nicht durchgelassen (Antwort {Status}). Deshalb zeigt der Bericht keine Funde. Die vollständige Prüfung ist morgen wieder möglich."
- Failed: Ihre Startseite ließ sich nicht prüfen: {Grund}. Deshalb zeigt der Bericht keine Funde. {Grund} is the phrase of the scan screen (B2 part 3): "sie hat nicht rechtzeitig geantwortet", "der Server war nicht erreichbar", "der Server hat mit dem Fehler {Status} geantwortet", "unter dieser Adresse gibt es keine Website", "sie stellt mehr Anfragen oder liefert mehr Daten, als die Prüfung aufzeichnet", "unter der Adresse liegt keine Webseite, sondern eine Datei", "bei der Prüfung ist ein Fehler aufgetreten".
- Refused address: Diese Adresse dürfen wir nicht prüfen: {Grund}. Deshalb zeigt der Bericht keine Funde. {Grund} as on the scan screen ("die Seite leitet mehr als fünfmal weiter", …).
- Almost empty page: the text of `report-page-almost-empty` (fix-a1, fix-a2). A page still loading after 15 s: the text of `report-page-still-loading` (fix-a6). Texts read only in part: the texts of `report-truncated-page` (fix-a4).
- Lists cut (instead of `report-truncated-findings` and `-services` of fix-a4, which name the Stückliste and the list of findings that the page shows only from B4 on; review of B3 part 2): "Der Bericht enthält nur die wichtigsten {shown} von {total} Punkten." and "Der Bericht enthält nur {shown} von {total} fremden Diensten."
- A notice the page does not know: Der Bericht zeigt, was wir prüfen konnten. (B2 part 3)
- Status: Entwurf

### Prüfmaße

- "Ist" of "Bilder mit Beschreibung" on a page without images: keine Bilder (Fedor, 24.11.2026).
- "Ist" of a row that was checked but has no value (an unsure result, or a report of a capture made before a fix): nicht ermittelt. "nicht geprüft" stays for a row that did not run.
- A report whose homepage did not load (blocked, refused, failed) has no Prüfmaße table.
- Status: Entwurf

### "Drei Dinge"

- Heading with two priorities: Zwei Dinge sollten Sie zuerst beheben. With one: Das sollten Sie zuerst beheben. With none: "Keine vorrangigen Punkte" and the line "In den geprüften Teilen hat die automatische Prüfung keinen Punkt mit Risiko gefunden."
- A report that measured no homepage (blocked, refused, failed, almost empty page) has no such section and no plan; an almost empty page has no Zeitschnitt either (review of B3 part 2).
- Status: Entwurf

### Zeitschnitt A–A

- No banner seen: "Kein Einwilligungsbanner erkannt." (no cut, and no key of the cut in the legend).
- A banner after the window: "Einwilligungsbanner erscheint nach {s} s, nach diesem Ausschnitt."
- No third party in the window: "In den ersten drei Sekunden keine Anfrage an fremde Server."
- The small line of the site's own files (Fedor's answer 1 of B3 part 1): "Ihre Dateien: {Arten}" with the words of the types the report gives, each once, joined with ", " and " und ": "Design" (style sheets and fonts) and "Skripte" are the reference's words; "Bilder", "Medien" (video and audio), "Daten" (xhr, fetch, event streams, web sockets) and "Weiteres" (anything else) are drafts. Without types (a report made before) or with other files only: "Ihre Dateien" (the draft of B3 part 1).
- Status: Entwurf

## Session B4 part 1

The lower part of the report (Stückliste, the finding details with the system tabs, the help block, the title block) and the note next to the country of the visit. The texts of `design/reference/bericht.html` are final and are not listed (the fix instructions for Shopify, Wix, Jimdo and Shopware stay drafts by `design/README.md`); these are the texts the reference does not have. They live in `web/lib/report-detail-texts.ts` and `web/lib/report-texts.ts`; every one is an Entwurf.

### Head: the country of the visit (Fedor, answer 3)

- A second line under the country, small and grey: "Unser Prüfbrowser läuft in einem Rechenzentrum in der EU und ist eingestellt wie ein Besucher aus Deutschland: deutsche Sprache, Zeitzone Berlin."
- Without "in der EU" for a country outside the EU; without the part after "Rechenzentrum" when the report does not say `de-DE` and `Europe/Berlin`: "Unser Prüfbrowser läuft in einem Rechenzentrum in der EU."
- The quick check has no browser: "Unsere Abfrage kam aus einem Rechenzentrum in der EU." (review of B4 part 1).
- Status: Entwurf

### Stückliste

- With one service: 1 Dienst gefunden.
- Anbieter of an unknown service: unbekannt.
- The small line by category (the reference's are "Schriften", "lädt weitere Skripte", "Statistik" and, for a public CDN, "Skripte"): Aufzeichnung von Besuchen (session recording), Marketing, Werbung, Werbung in sozialen Netzwerken (social pixels), Karte, Video (the reference's "Produktvideo" names the use on the page, which the scan does not know), Beiträge aus sozialen Netzwerken (embeds), Chat, Bewertungen, Terminbuchung, Widgets, Zahlung, Schutz vor Bots (captcha), Werkzeug für Barrierefreiheit (overlay), Übersetzung, Dienst Ihres Systems (platform), Einwilligungstool, Weiteres, unbekannter Dienst.
- "Daten gehen an" (the reference's are "Server in den USA möglich" and "weltweites Servernetz"): Server in der EU; nicht bekannt.
- The tag of "Einwilligung" (the reference's are "fehlt" and "Graubereich"): nicht nötig (blue; the consent tool itself, a service of the site), keine Antwort (grey; no request of the service got an answer), bitte manuell prüfen (grey). The reference's "wird eingeholt" needs a service that waits for a click, which the scan does not see.
- Status: Entwurf

### Finding details

- "Was passiert" of a service of the classes consent-required and usually-consent, after the reference's sentence for Google Fonts: "Ihre Startseite stellt {Anzahl} an Server von {Anbieter}, die erste {Sekunden} nach dem Aufruf. {Anbieter} erhält dabei die IP-Adresse jedes Besuchers, bevor dieser zustimmen kann." ({Anzahl}: "eine Anfrage", "zwei Anfragen" … "zwölf Anfragen", then digits; {Sekunden}: "0,3 Sekunden", "1 Sekunde", "weniger als 0,1 Sekunden".)
- When the first request came after the banner, or no banner was seen, the second sentence (also of Google Fonts) is: "{Anbieter} erhält dabei die IP-Adresse jedes Besuchers, ohne dass dieser zugestimmt hat." The reference's "bevor dieser zustimmen kann" is true only before the banner.
- One request: "Ihre Startseite stellt eine Anfrage an Server von {Anbieter}, {Sekunden} nach dem Aufruf." (no "die erste").
- Ist next to "0 Anfragen an {Anbieter}" in the same case: "{n} Anfragen, ohne Einwilligung" (the reference: "2 Anfragen, vor dem Banner"); "1 Anfrage, …". When only the first request started before the banner (or the report keeps fewer requests than it counts): "{n} Anfragen, die erste vor dem Banner".
- The Soll and Ist of the contrast card are the values of its own text ("mind. 3 : 1" for large text), not the 4,5 : 1 of the Prüfmaß.
- A detected Shopware 5: its tab shows "Für Shopware 5 haben wir noch keine eigene Anleitung." (the Shopware steps of the reference are for Shopware 6).
- "Warum das wichtig ist", consent-required: "Für Dienste zur Statistik, Werbung und ähnliche Zwecke verlangen die deutschen Datenschutzbehörden eine Einwilligung, bevor sie im Browser des Besuchers starten. Ein Einwilligungsbanner allein genügt dafür nicht: Der Dienst darf erst nach der Zustimmung laden." (Sources: `dsk-oh-digitale-dienste`, `tdddg-25` in `docs/rules-sources.md`.)
- "Warum das wichtig ist", usually-consent: "Karten, Videos, Chat- und Bewertungsfenster fremder Anbieter brauchen nach Ansicht der deutschen Datenschutzbehörden meist eine Einwilligung, bevor sie laden. Eine gängige Lösung ist ein Platzhalter, der den Dienst erst nach einem Klick lädt."
- The cards of accessibility, HTTPS, the redirect and the Impressum link take the drafts above: "Fact and risk" split into "Was passiert" (the fact) and "Warum das wichtig ist" (the risk), and "Fix" as the steps of the "Montageanleitung" (one step per sentence, without tabs).
- A system tab without steps of its own and without general steps: "Für {System} haben wir noch keine eigene Anleitung." (not used yet: only Google Fonts has tabs, with all five systems).
- Status: Entwurf

### Texts that are still missing (finding × system)

- Third-party services with a risk: 32 services can be such a finding (classes precedent, consent-required, usually-consent of `scanner/data/third-party-services.json`); `fix-google-fonts` has all five systems (WordPress final, the other four drafts of the reference that still have to be checked against the real systems). Missing for all five systems: `fix-google-tag-manager`, `fix-google-analytics`, `fix-google-ads`, `fix-google-analytics-advertising-features`, `fix-yandex-metrica`, `fix-hotjar`, `fix-microsoft-clarity`, `fix-brevo-tracker`, `fix-klaviyo-client-events`, `fix-criteo`, `fix-microsoft-advertising-uet`, `fix-linkedin-insight-tag`, `fix-meta-pixel`, `fix-pinterest-tag`, `fix-snap-pixel`, `fix-tiktok-pixel`, `fix-x-pixel`, `fix-google-maps`, `fix-openstreetmap-tiles`, `fix-vimeo`, `fix-youtube`, `fix-youtube-nocookie`, `fix-facebook-social-plugins`, `fix-instagram-embeds`, `fix-x-embeds`, `fix-crisp`, `fix-intercom`, `fix-livechat`, `fix-smartsupp`, `fix-tawk-to`, `fix-zendesk-web-widget` (31 × 5 = 155 texts), and the "Was passiert" and "Warum das wichtig ist" of these classes are only the general drafts above.
- Accessibility (`a11y-color-contrast`, `-image-alt`, `-label`, `-link-name`, `-button-name`, `-html-has-lang`, `-html-lang-valid`), security (`security-https-missing`, `security-http-no-redirect`) and `legal-impressum-no-link`: only the general fix, no steps by system (10 × 5 = 50 texts).
- `security-headers` (low risk, can be among "Drei Dinge" when fewer findings have a higher risk): no "Was passiert", no "Warum das wichtig ist", no fix at all; its card shows only the title and Soll and Ist.
- Session texts-fix (Fedor's scope): every finding has its general text now, the services by their class and the five found most often by their own ("Session texts-fix" below); the card of the security headers has its texts. Steps by system only for those five; the other 27 services and the 10 other findings by system come after the launch (`docs/backlog.md`).
- Status: offen

## Session B4 part 2

The lower part of the report for a real id, its states without design, the copying and the actions of the head. Every text here is an Entwurf; the texts of `design/reference/bericht.html` are final and not listed.

### Short names of the services (Fedor, answer 2)

The name the report shows for a known service (Stückliste, the titles of "Drei Dinge" and of the finding details, the scan screen, the copied list), the field `shortName` of `scanner/data/third-party-services.json`. Brand names as the brands write them, without a version the scan does not tell ("Google Analytics", not "Google Analytics 4"). A German word in brackets only where one brand has several rules: "(Ladeskript)", "(Ereignisse)", "(Werbefunktionen)", "(erweiterter Datenschutzmodus)" (Google's German name of the Privacy Enhanced Mode), "(Telemetrie)", "(Skripte)", "(Cookie-Banner)". "Google Übersetzer" is the German name of Google Translate; "Jetpack CDN" stands for the image and file CDN of Jetpack (formerly "Site Accelerator"); "Cookie Compliance" is the product of Hu-manity.co. To be checked against the brands' own pages before the launch.

- fonts: Adobe Fonts (`adobe-fonts`), Bunny Fonts (`bunny-fonts`), Font Awesome (`font-awesome`), Google Fonts (`google-fonts`).
- tag-manager: Google Tag Manager (`google-tag-manager`).
- analytics: Cloudflare Web Analytics (`cloudflare-web-analytics`), etracker Analytics (`etracker`), Fathom Analytics (`fathom`), Google Analytics (`google-analytics`), Jetpack Stats (`jetpack-stats`), Matomo Cloud (`matomo-cloud`), Plausible Analytics (`plausible`), Yandex Metrica (`yandex-metrica`).
- session-recording: Hotjar (`hotjar`), Microsoft Clarity (`microsoft-clarity`), Mouseflow (`mouseflow`), Mouseflow (Ladeskript) (`mouseflow-loader`).
- marketing-automation: Brevo (`brevo-tracker`), HubSpot (`hubspot-tracking-code`), Klaviyo (Ereignisse) (`klaviyo-client-events`), Klaviyo (`klaviyo-onsite-js`), Leadfeeder (`leadfeeder`).
- advertising: Awin (`awin`), Criteo (`criteo`), Google Ads / AdSense (`google-ads`), Google Analytics (Werbefunktionen) (`google-analytics-advertising-features`), Microsoft Advertising (`microsoft-advertising-uet`).
- social-pixel: LinkedIn Insight Tag (`linkedin-insight-tag`), Meta Pixel (`meta-pixel`), Pinterest Tag (`pinterest-tag`), Snap Pixel (`snap-pixel`), TikTok Pixel (`tiktok-pixel`), X Pixel (`x-pixel`).
- maps: Google Maps (`google-maps`), OpenStreetMap (`openstreetmap-tiles`).
- video: Vimeo (`vimeo`), YouTube (`youtube`), YouTube (erweiterter Datenschutzmodus) (`youtube-nocookie`).
- social-embed: Facebook Social Plugins (`facebook-social-plugins`), Instagram (`instagram-embeds`), X (`x-embeds`).
- chat: Crisp (`crisp`), Intercom (`intercom`), LiveChat (`livechat`), Smartsupp (`smartsupp`), tawk.to (`tawk-to`), Tidio (`tidio`), Userlike (`userlike`), Zendesk (`zendesk-web-widget`).
- reviews: Judge.me (`judge-me`), ProvenExpert (`provenexpert`), Trusted Shops (`trusted-shops`), Trustpilot (`trustpilot`).
- booking: Calendly (`calendly`).
- widget-platform: Elfsight (`elfsight`), Trustindex (`trustindex`).
- payment: Klarna (`klarna`), PayPal (`paypal`), Stripe (`stripe`).
- captcha: Cloudflare Turnstile (`cloudflare-turnstile`), Friendly Captcha (`friendly-captcha`), Google reCAPTCHA (`google-recaptcha`), hCaptcha (`hcaptcha`).
- accessibility-overlay: accessiBe (`accessibe`), Eye-Able (`eye-able`), UserWay (`userway`).
- translation: Google Übersetzer (`google-translate-widget`), GTranslate (`gtranslate`).
- cdn: cdnjs (`cdnjs`), Google Hosted Libraries (`google-hosted-libraries`), Jetpack CDN (`jetpack-site-accelerator`), jQuery CDN (`jquery-cdn`), jsDelivr (`jsdelivr`), unpkg (`unpkg`), WordPress-Emojis (`wordpress-emoji`).
- platform: Jimdo (`jimdo-static-assets`), Shopify (`shopify-cdn`), Shopify (Telemetrie) (`shopify-platform-telemetry`), Wix (`wix-media`), Wix (Skripte) (`wix-platform-other`).
- consent: CCM19 (`ccm19`), consentmanager (`consentmanager`), Cookiebot (`cookiebot`), CookieFirst (`cookiefirst`), CookieYes (`cookieyes`), Didomi (`didomi`), Cookie Compliance (`hu-manity`), iubenda (`iubenda`), Klaro! (`klaro`), OneTrust (`onetrust`), Shopify (Cookie-Banner) (`shopify-privacy-banner`), Sourcepoint (`sourcepoint`), TrustArc (`trustarc`), Usercentrics (`usercentrics`).
- other: Gravatar (`gravatar`).
- Status: Entwurf

### The lower part on the report of a real id

- The country of the visit next to every finding about data sent before consent (Fedor, 21.11.2026), as the small grey line under "vor der Einwilligung" of its row in the Stückliste and under "Was passiert" of its card: "Land des Aufrufs: {Land}" ({Land} is the German name of the country, "Deutschland", "Niederlande"; the form with a colon needs no article, "aus den Niederlanden"). Not for a report without a country.
- A finding without a fix text yet, in the box of the "Montageanleitung": "Für diesen Punkt haben wir noch keine Anleitung." (the fix texts are a session of their own after B4).
- A card of a finding without any text or value (a text id the page does not know yet): "Was passiert": "Die Prüfung hat diesen Punkt gefunden. Eine Beschreibung dazu schreiben wir noch."
- The help block names what the priorities of "Drei Dinge" are about, in their order: "Schriften lokal einbinden", "die Einwilligung richtig einstellen", "Barrieren entfernen" (the reference's), and the drafts "HTTPS einrichten", "Sicherheits-Header setzen", "den Link zum Impressum setzen": "Ich behebe die Funde für Sie: {Aufgaben}. Antwort per E-Mail." With priorities of another kind: "Ich behebe die Funde für Sie. Antwort per E-Mail."
- The help block of a report without priorities (nothing to fix first, an almost empty page): heading "Sie möchten Ihre Website genauer prüfen lassen?", text "Unsere automatische Prüfung sieht nur die Startseite und das Impressum. Ich sehe mir Ihre Website gern genauer an. Antwort per E-Mail." The button "Hilfe bei der Umsetzung anfragen" stays.
- The copied list follows the reference's script ("Externe Dienste auf {Domain} (Prüfung vom {Datum}):", then "{Pos.}. {Dienst} ({Anbieter}), {kleine Zeile}", without the provider when it is the name itself). A short name with a word in brackets takes the provider into its brackets, or none when the name before them is the provider: "Mouseflow (Ladeskript), Aufzeichnung von Besuchen", "YouTube (erweiterter Datenschutzmodus, Google), Video". A cut list ends with "… und {n} weitere Dienste, die der Bericht nicht einzeln aufführt." ("… und 1 weiterer Dienst, den der Bericht nicht einzeln aufführt.").
- When the browser refuses the clipboard: "Die Liste konnte nicht kopiert werden." and "Der Link konnte nicht kopiert werden." (shown next to the button and said by the status region). "Liste kopiert" is the reference's, "Link kopiert" Fedor's (B3 part 2).
- Status: Entwurf

## Session B5 part 1

The BFSG page (design/reference/bfsg.html). Every text on the page is the reference's (final, not listed); the claims about the law are checked against sources in stage C (the list is in the report of B5 part 1 and in `docs/backlog.md`).

- The title of the browser tab: "BFSG-Prüfschema, Website-Check DE" (the reference: "BFSG-Prüfschema, Bauplan", as the other pages: "Prüfbericht, Website-Check DE").
- Status: Entwurf

## Session texts-fix (25.11.2026)

General texts for every finding the report builder can give (Fedor, message of the session of the fix texts): the explanation and the general way to fix it. Before this session, the ids of `docs/report-schema.md` ("Texts that do not exist yet") had no text; they follow here. The texts the report page shows live in `web/lib/report-detail-texts.ts`; a unit test (`web/test/report-texts-complete.test.ts`) checks that every text id of the report builder (`REPORT_TEXT_IDS` in `scanner/src/report/types.ts`) has a section in this file, that every finding that can be among "Drei Dinge" has a card with "Was passiert", "Warum das wichtig ist" and steps, and that no text holds a forbidden word of the brief. Every text is an Entwurf; the review by a native speaker is stage C.

Rules of this session (Fedor): no menu path or name of a setting that is not in the official documentation; tools are named as options without a judgement, a free one too when there is one; no forbidden word of the brief.

### The five services with a risk found most often (step 3)

Counted in the latest analysis of each of the 30 test sites (`local/results`, no site visited): a service counts once per site, only a known service of the classes precedent, consent-required and usually-consent. Google Tag Manager 8 sites, Google Analytics 6, Google Fonts 5, Google Ads / AdSense 3, YouTube (erweiterter Datenschutzmodus) 2; every other such service at most 1 (Meta Pixel, Google Analytics (Werbefunktionen), Facebook Social Plugins, Instagram, Google Maps, Microsoft Advertising, Pinterest Tag). The 30 reports of `check:report --reports` (27 different sites, one report each) give the same first three, then YouTube (erweiterter Datenschutzmodus) with 2 and Google Ads / AdSense with 1, the same as six other services; the analysis of the 30 sites decides the fifth place. These five get steps by system in this session (Fedor: only the five most frequent); every other service the general text of its class.

- Status: Entwurf

### General fix by class of service (`third-party-consent-required`, `third-party-usually-consent`, `third-party-precedent`)

The steps of the "Montageanleitung" (without tabs) of a known service whose finding has no text of its own (`fix-<service>`), by the class of the service. "Was passiert" and "Warum das wichtig ist" of these classes are the drafts of "Session B4 part 1" (and the reference's for Google Fonts).

- `third-party-consent-required` (statistics, tag managers, advertising, social pixels, session recording, marketing automation):
  1. Laden Sie den Dienst erst, nachdem der Besucher im Einwilligungsbanner zugestimmt hat. Vorher darf sein Skript nicht starten, auch nicht über einen Tag Manager.
  2. Das übernimmt ein Einwilligungstool: Sie tragen den Dienst dort ein, und das Tool lädt ihn erst nach der Zustimmung. Beispiele sind CCM19, Cookiebot, Usercentrics und das quelloffene, kostenlose Klaro!.
  3. Starten Sie danach eine neue Prüfung. Vor der Zustimmung sollte keine Anfrage an den Anbieter mehr zu sehen sein.
- `third-party-usually-consent` (maps, videos, embedded posts, chat and review windows):
  1. Ersetzen Sie den eingebetteten Inhalt zunächst durch einen Platzhalter, etwa einen kurzen Hinweis oder ein Bild von Ihrem eigenen Server. Der Inhalt des Anbieters lädt erst, wenn der Besucher darauf klickt oder im Einwilligungsbanner zustimmt.
  2. Viele Einwilligungstools bringen solche Platzhalter mit. Ohne Werkzeug genügt oft ein einfacher Link, etwa zur Anfahrt auf der Karte des Anbieters oder zum Video auf seiner Seite.
  3. Starten Sie danach eine neue Prüfung. Vor dem Klick oder der Zustimmung sollte keine Anfrage an den Anbieter mehr zu sehen sein.
- `third-party-precedent` (only Google Fonts): the general steps of `fix-google-fonts` below.
- Used for: `fix-<service>` of every known service of these classes without a text of its own, in this session 27 of the 32 services (all but Google Fonts, Google Tag Manager, Google Analytics, Google Ads / AdSense and YouTube (erweiterter Datenschutzmodus), which have their own general steps below).
- Sources: see "Sources of the general texts" below.
- Status: Entwurf

### General fix of the five services found most often (`fix-google-fonts`, `fix-google-tag-manager`, `fix-google-analytics`, `fix-google-ads`, `fix-youtube-nocookie`)

The five services of step 3 above. Their general steps stand without tabs, and in a system tab that has no confirmed steps of its own (`SERVICE_FIX` in `web/lib/report-detail-texts.ts`).

- `fix-google-fonts`:
  1. Laden Sie die Schriften, die Ihre Seite nutzt, bei Google Fonts herunter und legen Sie die Dateien auf Ihren eigenen Server.
  2. Binden Sie sie mit @font-face aus diesen Dateien ein und entfernen Sie jeden Verweis auf fonts.googleapis.com und fonts.gstatic.com, auch in Theme, Plugins und eingefügtem Code.
  3. Starten Sie eine neue Prüfung. Die Anfrage an Google sollte verschwunden sein. (The sentence of the reference's WordPress steps.)
- `fix-google-tag-manager`:
  1. Laden Sie den Google Tag Manager erst nach der Zustimmung im Einwilligungsbanner. Schon das Laden seines Skripts ist eine Anfrage an Google, gleich welche Tags darin stehen.
  2. Tragen Sie ihn dazu in Ihrem Einwilligungstool als eigenen Dienst ein, so dass das Tool ihn bis zur Zustimmung blockiert. Wird das Einwilligungsbanner selbst über den Tag Manager eingebunden, binden Sie es stattdessen direkt in die Seite ein.
  3. Starten Sie danach eine neue Prüfung. Vor der Zustimmung sollte keine Anfrage an googletagmanager.com mehr zu sehen sein.
- `fix-google-analytics`:
  1. Laden Sie Google Analytics erst nach der Zustimmung im Einwilligungsbanner: Ihr Einwilligungstool blockiert den Dienst, bis der Besucher zustimmt.
  2. Wenn Sie den Einwilligungsmodus von Google (Consent Mode) nutzen, wählen Sie die einfache Umsetzung („basic“). In der erweiterten Umsetzung („advanced“) laden die Google-Tags schon beim Aufruf und senden ohne Zustimmung Daten ohne Cookies an Google.
  3. Starten Sie danach eine neue Prüfung. Vor der Zustimmung sollte keine Anfrage an Google Analytics mehr zu sehen sein.
- `fix-google-ads`:
  1. Laden Sie die Werbe-Tags von Google, etwa das Conversion-Tracking und Remarketing von Google Ads oder die Anzeigen von AdSense, erst nach der Zustimmung im Einwilligungsbanner: Ihr Einwilligungstool blockiert sie, bis der Besucher zustimmt.
  2. Wenn Sie den Einwilligungsmodus von Google (Consent Mode) nutzen, wählen Sie die einfache Umsetzung („basic“). In der erweiterten Umsetzung („advanced“) laden die Google-Tags schon beim Aufruf und senden ohne Zustimmung Daten ohne Cookies an Google.
  3. Starten Sie danach eine neue Prüfung. Vor der Zustimmung sollte keine Anfrage an doubleclick.net, googlesyndication.com oder googleadservices.com mehr zu sehen sein.
- `fix-youtube-nocookie`:
  1. Laden Sie das Video erst nach einem Klick: An seiner Stelle steht zuerst ein Vorschaubild von Ihrem eigenen Server mit einem kurzen Hinweis. Der Player lädt erst, wenn der Besucher klickt oder im Einwilligungsbanner zustimmt.
  2. Der erweiterte Datenschutzmodus allein genügt dafür nicht: Er ändert, was YouTube speichert, aber der Player lädt trotzdem beim Aufruf Ihrer Seite von Servern von Google.
  3. Viele Einwilligungstools bringen solche Platzhalter mit. Ohne Werkzeug genügt ein Vorschaubild von Ihrem Server mit einem Link zum Video auf YouTube. Starten Sie danach eine neue Prüfung.
- Sources: Google, "Consent mode overview" (basic: tags are not loaded before the user interacts with the banner, no data is sent; advanced: tags load when the page opens and send cookieless pings without consent): https://developers.google.com/tag-platform/security/concepts/consent-mode; YouTube Help, privacy-enhanced mode (`youtube-help-privacy-enhanced-mode` in `docs/rules-sources.md`); Google Fonts, the download of a family and the open licences of the fonts: https://fonts.google.com/knowledge and the FAQ https://developers.google.com/fonts/faq. The step "Wird das Einwilligungsbanner selbst über den Tag Manager eingebunden" follows from step 1: a banner loaded by the Tag Manager needs its script before any consent.
- Status: Entwurf

### `security-headers`

- Title (B3 part 1): {present} von {total} Sicherheits-Headern gesetzt
- Was passiert: Von den {total} gängigen Sicherheits-Headern zählen wir bei Ihrer Startseite {present} als gesetzt. Welche fehlen oder nicht wirken, steht in der Anleitung.
- Warum das wichtig ist: Diese Header sind Anweisungen Ihres Servers an den Browser. Sie erschweren bekannte Angriffe, etwa das Einschleusen fremder Skripte oder das Umlenken auf eine unverschlüsselte Verbindung. Fehlen sie, entfällt dieser zusätzliche Schutz; Ihre Seite funktioniert trotzdem.
- Montageanleitung (without tabs): first "Die Header setzen Sie in der Konfiguration Ihres Servers oder im Kundenbereich Ihres Hosters. Haben Sie darauf keinen Zugriff, etwa bei einem Baukastensystem, fragen Sie Ihren Anbieter, welche Header er sendet."; then one step per header that does not count (in the order Strict-Transport-Security, Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy): the title of its text and its fix, as drafted in "Security" and "Session fix-a6" above (for example "X-Content-Type-Options nicht gesetzt. Senden Sie den Header X-Content-Type-Options: nosniff. Er stört nichts, solange Ihr Server Skripte und Stylesheets mit dem richtigen Typ ausliefert."); last "Starten Sie danach eine neue Prüfung."
- Used when: the finding `security:headers` (fewer than five headers count; low risk) is among "Drei Dinge". Like every header text, none of these says that a law requires a header.
- Status: Entwurf

### `security-http-redirect-not-checked`

- Title: Weiterleitung auf https:// nicht geprüft
- Fact: Die Anfrage an Ihre Adresse mit http:// haben wir bei dieser Prüfung nicht gestellt. Ob Ihr Server auf https:// weiterleitet, wissen wir deshalb nicht.
- Fix: Starten Sie später eine neue Prüfung. Bis dahin: bitte manuell prüfen.
- Used when: the check of the http:// address did not run (`httpRedirect` `not-checked`). Without a risk.
- Status: Entwurf

### `third-party-unknown`

- Title: {service}: unbekannter Dienst, bitte manuell prüfen
- Fact: Ihre Startseite hat Anfragen an {service} gestellt, einen fremden Server, den unsere Liste nicht kennt. Ob dabei Daten an einen Anbieter gehen, der eine Einwilligung braucht, können wir deshalb nicht sagen.
- Fix: Bitte manuell prüfen: Finden Sie heraus, zu welchem Dienst dieser Server gehört, etwa mit Ihrer Webagentur oder Ihrem Hoster. Gehört er zu einem fremden Anbieter, nennen Sie ihn in Ihrer Datenschutzerklärung und klären Sie, ob er erst nach einer Einwilligung laden darf.
- Used when: a host of another registrable domain that no rule names (`known: false`); a hint without a risk. `{service}` is the host name, a string of the page (a text node only).
- Status: Entwurf

### `third-party-grey-zone`

- Title: {service}: Graubereich
- Fact: Ihre Startseite lädt Dateien von {service} ({provider}). Der Anbieter erhält dabei die IP-Adresse Ihrer Besucher. Für diesen Dienst haben wir keine Quelle, die ihn eindeutig einordnet, deshalb führen wir ihn als Graubereich und nicht als Fund.
- Fix: Nennen Sie den Dienst in Ihrer Datenschutzerklärung. Wo Sie die Einbindung selbst steuern, etwa bei Skripten aus einem öffentlichen Servernetz, können Sie die Dateien auch auf Ihren eigenen Server legen; dann geht beim Aufruf keine Anfrage an den Anbieter.
- Used when: a known service of the class `grey-zone` (public CDNs, and every service without a source for another class, product rule 2); a hint, never a finding.
- Status: Entwurf

### `third-party-unconfirmed`

- Title: {service}: Anfragen ohne Antwort, bitte manuell prüfen
- Fact: Ihre Startseite hat Anfragen an {service} ({provider}) gestellt, aber keine davon hat bei unserem Besuch eine Antwort bekommen. Ob dabei Daten beim Anbieter angekommen sind, wissen wir nicht.
- Fix: Bitte manuell prüfen: Binden Sie {service} auf Ihrer Seite ein? Dann gilt dasselbe wie für jeden solchen Dienst: Er darf erst nach der Zustimmung im Einwilligungsbanner laden.
- Used when: a known service of a class that would be a finding, whose requests got no answer (the Stückliste says "keine Antwort"); a hint without a risk.
- Status: Entwurf

### `legal-not-checked`

- Title: Pflichtangaben nicht geprüft
- Fact: Ihre Startseite konnte bei dieser Prüfung nicht gelesen werden. Die Links zu Impressum und Datenschutzerklärung und die Angaben im Impressum haben wir deshalb nicht geprüft.
- Fix: Starten Sie später eine neue Prüfung. Bis dahin gilt für diese Punkte: bitte manuell prüfen.
- Used when: the homepage was not read (`legal.homepageRead` false). Without a risk.
- Status: Entwurf

### `legal-impressum-same-page`

- Title: Impressum auf der Startseite, bitte manuell prüfen
- Fact: Der Link zum Impressum führt zu einer Stelle Ihrer Startseite. Die Angaben dort haben wir nicht einzeln geprüft, weil die Startseite auch andere Namen und Anschriften enthalten kann.
- Fix: Bitte manuell prüfen: Stehen im Abschnitt mit dem Impressum Ihre Anschrift, eine E-Mail-Adresse und, wenn es sie für Ihr Unternehmen gibt, Handelsregister und USt-IdNr?
- Used when: the Impressum link is an anchor of the homepage (state `same-page`). Without a risk.
- Status: Entwurf

### `legal-impressum-pdf`

- Title: Impressum als PDF-Datei, bitte manuell prüfen
- Fact: Der Link zum Impressum führt zu einer PDF-Datei. Ihren Inhalt lesen wir nicht, die Angaben darin haben wir deshalb nicht geprüft.
- Fix: Bitte manuell prüfen: Stehen in der Datei Ihre Anschrift, eine E-Mail-Adresse und, wenn es sie für Ihr Unternehmen gibt, Handelsregister und USt-IdNr?
- Used when: the Impressum link leads to a PDF file (state `pdf`). Without a risk.
- Status: Entwurf

### `legal-impressum-failed`

- Title: Impressum nicht lesbar, bitte manuell prüfen
- Fact: Den Link zum Impressum haben wir gefunden, die Seite dahinter aber nicht als Impressum lesen können. Sie hat zum Beispiel nicht rechtzeitig geantwortet, eine Fehlermeldung gezeigt oder keinen Hinweis auf ein Impressum enthalten.
- Fix: Bitte manuell prüfen: Öffnen Sie den Link „Impressum“ auf Ihrer Startseite und sehen Sie nach, ob er zu Ihrem Impressum führt.
- Used when: the state of the Impressum is `failed` (the page did not load, or it is no Impressum: an error page with HTTP 200, the homepage again, a page without any sign of an Impressum; fix-a3). Without a risk.
- Status: Entwurf

### `legal-impressum-not-checked`

- Title: Impressum nicht geprüft
- Fact: Den Link zum Impressum haben wir gefunden, die Seite dahinter bei dieser Prüfung aber nicht aufgerufen. Die Angaben darin sind deshalb nicht geprüft.
- Fix: Starten Sie später eine neue Prüfung. Bis dahin: bitte manuell prüfen.
- Used when: the state of the Impressum is `not-captured`. Without a risk.
- Status: Entwurf

### `legal-field-not-found`

- Title: {Angabe} im Impressum nicht gefunden, bitte manuell prüfen. {Angabe}: "Anschrift" (`address`), "E-Mail-Adresse" (`email`), "Handelsregister" (`handelsregister`), "USt-IdNr" (`ustId`), the names of the rows of the Prüfmaß.
- Fact: Im Impressum haben wir {die Angabe} nicht gefunden. Das heißt nicht, dass sie fehlt: Sie kann zum Beispiel als Bild eingebunden oder ungewöhnlich geschrieben sein.
- Fix: Bitte manuell prüfen: Steht die Angabe als Text im Impressum? Handelsregister und USt-IdNr gehören nur dann dorthin, wenn es sie für Ihr Unternehmen gibt.
- Used when: a field of the Impressum is `not-found` (product rule 3: "nicht gefunden, bitte manuell prüfen", never "fehlt"). Without a risk.
- Status: Entwurf

### `legal-datenschutz-no-link`

- Title: Link zur Datenschutzerklärung nicht gefunden, bitte manuell prüfen
- Fact: Auf der Startseite haben wir keinen Link gefunden, der zur Datenschutzerklärung führt. Er kann in einem Menü stecken, das sich erst nach einem Klick öffnet, und unsere Prüfung klickt nichts an.
- Fix: Bitte manuell prüfen: Ist ein Link „Datenschutz“ oder „Datenschutzerklärung“ ohne weiteren Klick sichtbar, etwa in der Fußzeile? Wenn nicht, setzen Sie ihn dort auf jeder Seite.
- Used when: no link to a Datenschutzerklärung on the homepage. Without a risk (product rule 3: only the missing Impressum link has a risk).
- Status: Entwurf

### `legal-accessibility-statement-not-found`

- Title: Erklärung zur Barrierefreiheit nicht gefunden, bitte manuell prüfen
- Fact: Auf der Startseite haben wir keinen Link zu einer Erklärung zur Barrierefreiheit gefunden. Ob Ihre Website eine braucht, hängt davon ab, ob das BFSG für Ihr Angebot gilt; das zeigt das BFSG-Prüfschema.
- Fix: Bitte manuell prüfen: Gilt das BFSG für Ihr Angebot, verlinken Sie die Erklärung zur Barrierefreiheit auf jeder Seite, etwa in der Fußzeile neben Impressum und Datenschutz.
- Used when: the site looks like a shop and no link to an accessibility statement was found (the decided wording of the Prüfmaß, conflict 14 of `docs/report-schema.md`). Without a risk.
- Status: Entwurf

### Notices of the report (`report-quick-incomplete`, `report-blocked`, `report-not-allowed`, `report-failed`, `report-page-almost-empty`)

Their texts are the lines of "The note under the head" (Session B3 part 2) and of `report-page-almost-empty` (fix-a1); listed here so that every text id of the builder has a section.

- Status: Entwurf

### Sources of the general texts

- Google, Consent mode overview: https://developers.google.com/tag-platform/security/concepts/consent-mode
- YouTube Help, privacy-enhanced mode: `youtube-help-privacy-enhanced-mode` in `docs/rules-sources.md`.
- Klaro!: `klaro-readme` in `docs/rules-sources.md`; licence BSD-3-Clause: https://github.com/kiprotect/klaro

## Sources

- W3C, Web Content Accessibility Guidelines (WCAG) 2.2: https://www.w3.org/TR/WCAG22/
- W3C, Understanding SC 1.1.1 Non-text Content: https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html
- W3C, Understanding SC 1.3.1 Info and Relationships: https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html
- W3C, Understanding SC 1.4.3 Contrast (Minimum) (4.5:1, 3:1 for large text, definition of large text): https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- W3C, Understanding SC 2.4.4 Link Purpose (In Context): https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html
- W3C, Understanding SC 3.1.1 Language of Page: https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html
- W3C, Understanding SC 3.3.2 Labels or Instructions: https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
- W3C, Understanding SC 4.1.2 Name, Role, Value: https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html
- Deque, axe-core rule descriptions (rules and their WCAG tags): https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md
- WebAIM, The WebAIM Million (the six most common automatically detected error types): https://webaim.org/projects/million/
- MDN, lang attribute: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang
- IETF, RFC 5646 (BCP 47), Tags for Identifying Languages (subtags separated by hyphens): https://www.rfc-editor.org/rfc/rfc5646
- IETF, RFC 6797, HTTP Strict Transport Security (section 6.1.1: max-age, max-age=0 ends HSTS for the host; section 8.1: the header is ignored over non-secure transport): https://www.rfc-editor.org/rfc/rfc6797
- MDN, Strict-Transport-Security: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security
- MDN, Content-Security-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
- MDN, Content-Security-Policy-Report-Only: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only
- W3C, Content Security Policy Level 3 (meta element: no frame-ancestors, report-uri or sandbox, and it applies only to content after it): https://www.w3.org/TR/CSP3/
- MDN, X-Content-Type-Options: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options
- WHATWG, Fetch Standard, X-Content-Type-Options header (only "nosniff"): https://fetch.spec.whatwg.org/#x-content-type-options-header
- MDN, Referrer-Policy (default strict-origin-when-cross-origin, comma-separated fallback list): https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
- W3C, Referrer Policy: https://www.w3.org/TR/referrer-policy/
- MDN, meta name="referrer": https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta/name
- WHATWG, HTML Standard, meta name="referrer" (legacy values never, default, always, origin-when-crossorigin): https://html.spec.whatwg.org/multipage/semantics.html#meta-referrer
- MDN, Permissions-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy
- MDN, Feature-Policy (renamed to Permissions-Policy, deprecated): https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Feature-Policy
- W3C, Permissions Policy: https://www.w3.org/TR/permissions-policy/
- Chromium Blog, "A secure web is here to stay" (HTTP pages marked "Not secure"): https://blog.chromium.org/2018/02/a-secure-web-is-here-to-stay.html
- Let's Encrypt (free TLS certificates): https://letsencrypt.org/

## Note for Fedor

The Prüfmaße table in `design/reference/bericht.html` is headed "Soll nach Gesetz und Richtlinie" and contains the row "Sicherheits-Header" with "5 von 5" as the target. A reader can take this to mean that a law requires these five headers, while the drafts above say on purpose that no law names them. `design/` is read-only for the agent, so nothing was changed there; this is only a question for you: keep the heading as it is, or reword it (for example "Soll nach Gesetz, Richtlinie und gängiger Praxis") in a later design change.
