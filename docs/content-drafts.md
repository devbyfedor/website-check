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
- Used when: the http:// check gives no clear answer; `{reason}` is one of "keine Antwort innerhalb von 10 Sekunden", "Fehlerseite mit Status {status}", "mehr als 5 Weiterleitungen", "Weiterleitung auf eine Adresse, die wir aus Sicherheitsgründen nicht aufrufen", "Weiterleitung ohne Zieladresse", and since session fix-a2 "die Seite unter http:// enthält ein Skript, das die Adresse auf https:// umstellen kann; ob es das tut, zeigt nur ein Browser" "die Seite unter http:// leitet auf eine weitere Adresse mit http:// weiter, die wir nicht geprüft haben" and "die Seite unter http:// wurde nicht vollständig übertragen oder ihr Kopfbereich ist länger als der geprüfte Anfang".
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
- Used when: Not used yet: the analyzer has no invalid state for CSP. Meant for a policy (header or meta) that contains directives or source values that browsers do not recognise; `{value}` would list those parts. An empty value counts as missing.
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
