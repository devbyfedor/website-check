// German texts of the list of manual checks and hints under the finding details (session B5 part 2, Fedor: "die
// manuellen Prüfungen und Hinweise bekommen eigene Texte im Bericht", one short text per item, the same hint for
// several items once, as a group). A state the design does not show, built from elements of bericht.html (the head of
// a section, the list of "Drei Dinge", the tag of the Stückliste, h3s and bodys). Every text is a DRAFT
// (docs/content-drafts.md, "Session B5 part 2"); the titles and texts follow the drafts of their text ids there, shortened
// to one text that says what to check. A value of the scanned page is never put into a template string here: the
// names of services are parts of their own (`{page}`), which the page shows as text nodes in <bdi>.

import type { TextId } from '@website-check/scanner/report';

export const CHECKS_TEXTS = {
  heading: 'Bitte selbst prüfen',
  /** "5 Dienste gefunden" of the Stückliste, for the items of this list. */
  count: (n: number) => (n === 1 ? '1 Punkt' : `${n} Punkte`),
  /** The tag of an item: a manual check (kind `manual`), a hint (kind `hint`). */
  tagManual: 'bitte manuell prüfen',
  tagHint: 'Hinweis',
  /** An item whose text id this page does not know (a report of a newer scanner). */
  otherTitle: 'Weiterer Punkt',
  otherManual: 'Hier war die automatische Prüfung unsicher. Bitte prüfen Sie diesen Punkt selbst.',
  otherHint: 'Ein Hinweis der Prüfung, kein Fund.',
} as const;

/** The names of the Impressum fields (`params.field` of `legal-field-not-found`), as the drafts of that id name them. */
export const FIELD_NAMES: Readonly<Record<string, string>> = {
  address: 'Anschrift',
  email: 'E-Mail-Adresse',
  handelsregister: 'Handelsregister',
  ustId: 'USt-IdNr',
};

/** The German names of the accessibility checks (`params.check`), as `{check}` of docs/content-drafts.md. */
export const CHECK_NAMES: Readonly<Record<string, string>> = {
  'color-contrast': 'Kontrast',
  'image-alt': 'Bilder',
  label: 'Formularfelder',
  'link-name': 'Links',
  'button-name': 'Schaltflächen',
  'page-language': 'Seitensprache',
};

/**
 * One text per item. `title`: one item; `group`: several items of the same text id, shown once with their names
 * (`{names}`: services, Impressum fields or accessibility checks). `text`/`groupText`: what to check. `{service}` and
 * `{names}` hold strings of the page (the name of an unknown service is its host) and are filled as parts of their own.
 */
export interface CheckText {
  title: string;
  text: string;
  group?: { title: string; text: string };
}

export const CHECK_TEXTS: Partial<Record<TextId, CheckText>> = {
  // Mandatory information.
  'legal-impressum-no-link': {
    title: 'Impressum-Link nicht gefunden',
    text: 'Ist der Link „Impressum“ auf Ihrer Startseite ohne weiteren Klick sichtbar, etwa in der Fußzeile? Unsere Prüfung öffnet keine Menüs.',
  },
  'legal-impressum-no-link-empty-page': {
    title: 'Impressum-Link nicht gefunden',
    text: 'Die Seite zeigte bei unserem Besuch fast keinen Inhalt. Öffnen Sie Ihre Startseite in einem Browser und prüfen Sie, ob der Link „Impressum“ ohne weiteren Klick sichtbar ist.',
  },
  'legal-impressum-no-link-links-cut': {
    title: 'Impressum-Link nicht gefunden',
    text: 'Wir haben nicht alle Links Ihrer Startseite gelesen. Ist der Link „Impressum“ ohne weiteren Klick sichtbar?',
  },
  'legal-impressum-no-link-quick': {
    title: 'Impressum-Link im HTML-Quelltext nicht gefunden',
    text: 'Die Schnellprüfung sieht keine Links, die erst ein Skript im Browser aufbaut. Öffnen Sie Ihre Startseite in einem Browser und sehen Sie nach, ob der Link „Impressum“ ohne weiteren Klick sichtbar ist.',
  },
  'legal-impressum-same-page': {
    title: 'Impressum auf der Startseite',
    text: 'Stehen im Abschnitt mit dem Impressum Ihre Anschrift, eine E-Mail-Adresse und, wenn es sie für Ihr Unternehmen gibt, Handelsregister und USt-IdNr?',
  },
  'legal-impressum-pdf': {
    title: 'Impressum als PDF-Datei',
    text: 'Den Inhalt der Datei lesen wir nicht. Stehen darin Ihre Anschrift, eine E-Mail-Adresse und, wenn es sie für Ihr Unternehmen gibt, Handelsregister und USt-IdNr?',
  },
  'legal-impressum-failed': {
    title: 'Impressum nicht lesbar',
    text: 'Öffnen Sie den Link „Impressum“ auf Ihrer Startseite und sehen Sie nach, ob er zu Ihrem Impressum führt.',
  },
  'legal-field-not-found': {
    title: '{names} im Impressum nicht gefunden',
    text: 'Steht die Angabe als Text im Impressum? Sie kann zum Beispiel als Bild eingebunden oder ungewöhnlich geschrieben sein. Handelsregister und USt-IdNr gehören nur dann dorthin, wenn es sie für Ihr Unternehmen gibt.',
    group: {
      title: 'Im Impressum nicht gefunden: {names}',
      text: 'Stehen diese Angaben als Text im Impressum? Sie können zum Beispiel als Bild eingebunden oder ungewöhnlich geschrieben sein. Handelsregister und USt-IdNr gehören nur dann dorthin, wenn es sie für Ihr Unternehmen gibt.',
    },
  },
  'legal-datenschutz-no-link': {
    title: 'Link zur Datenschutzerklärung nicht gefunden',
    text: 'Ist ein Link „Datenschutz“ oder „Datenschutzerklärung“ ohne weiteren Klick sichtbar, etwa in der Fußzeile? Unsere Prüfung öffnet keine Menüs.',
  },
  'legal-datenschutz-uncertain': {
    title: 'Link zum Datenschutz: Ziel unklar',
    text: 'Öffnen Sie den Link „Datenschutz“ auf Ihrer Startseite. Steht dort die Datenschutzerklärung Ihrer Website, ist nichts zu tun; wenn nicht, verlinken Sie sie gut sichtbar, zum Beispiel in der Fußzeile.',
  },
  'legal-accessibility-statement-uncertain': {
    title: 'Link zur Barrierefreiheit gefunden',
    text: 'Öffnen Sie den Link und prüfen Sie, ob dort die Erklärung zur Barrierefreiheit steht und nicht etwa eine Leistungsseite.',
  },
  'legal-accessibility-statement-not-found': {
    title: 'Erklärung zur Barrierefreiheit nicht gefunden',
    text: 'Gilt das BFSG für Ihr Angebot, verlinken Sie die Erklärung zur Barrierefreiheit auf jeder Seite, etwa in der Fußzeile neben Impressum und Datenschutz. Ob es gilt, zeigt das BFSG-Prüfschema.',
  },

  // Third-party services (hints, and the manual check of a request whose origin is unclear).
  'third-party-frame-unknown': {
    title: '{service}: Herkunft der Anfrage unklar',
    text: 'Binden Sie diesen Dienst selbst ein? Wenn nicht, gehört die Anfrage zu einem eingebetteten Inhalt eines anderen Anbieters, etwa einem Formular oder einem Video.',
    group: {
      title: 'Herkunft der Anfragen unklar: {names}',
      text: 'Binden Sie diese Dienste selbst ein? Wenn nicht, gehören die Anfragen zu einem eingebetteten Inhalt eines anderen Anbieters, etwa einem Formular oder einem Video.',
    },
  },
  'third-party-unknown': {
    title: '{service}: unbekannter Dienst',
    text: 'Finden Sie heraus, zu welchem Dienst dieser Server gehört, etwa mit Ihrer Webagentur oder Ihrem Hoster. Gehört er zu einem fremden Anbieter, nennen Sie ihn in Ihrer Datenschutzerklärung und klären Sie, ob er erst nach einer Einwilligung laden darf.',
    group: {
      title: 'Unbekannte Dienste: {names}',
      text: 'Finden Sie heraus, zu welchen Diensten diese Server gehören, etwa mit Ihrer Webagentur oder Ihrem Hoster. Gehört einer zu einem fremden Anbieter, nennen Sie ihn in Ihrer Datenschutzerklärung und klären Sie, ob er erst nach einer Einwilligung laden darf.',
    },
  },
  'third-party-grey-zone': {
    title: '{service}: Graubereich',
    text: 'Der Anbieter erhält die IP-Adresse Ihrer Besucher. Nennen Sie den Dienst in Ihrer Datenschutzerklärung. Dateien aus einem öffentlichen Servernetz können Sie auch auf Ihren eigenen Server legen.',
    group: {
      title: 'Graubereich: {names}',
      text: 'Die Anbieter erhalten die IP-Adresse Ihrer Besucher. Nennen Sie diese Dienste in Ihrer Datenschutzerklärung. Dateien aus einem öffentlichen Servernetz können Sie auch auf Ihren eigenen Server legen.',
    },
  },
  'third-party-unconfirmed': {
    title: '{service}: Anfragen ohne Antwort',
    text: 'Ob dabei Daten beim Anbieter angekommen sind, wissen wir nicht. Binden Sie den Dienst auf Ihrer Seite ein, darf er erst nach der Zustimmung im Einwilligungsbanner laden.',
    group: {
      title: 'Anfragen ohne Antwort: {names}',
      text: 'Ob dabei Daten bei den Anbietern angekommen sind, wissen wir nicht. Binden Sie diese Dienste auf Ihrer Seite ein, dürfen sie erst nach der Zustimmung im Einwilligungsbanner laden.',
    },
  },

  // Accessibility.
  'a11y-frame-not-checked': {
    title: 'Eingebetteter Bereich nicht geprüft',
    text: 'Ein eingebetteter Bereich (iframe) nimmt {share} % des ersten Bildschirms ein; die Prüfung gilt nur für den Rest der Seite. Prüfen Sie ihn mit einem Werkzeug wie WAVE oder Lighthouse, oder fragen Sie seinen Anbieter nach der Barrierefreiheit.',
  },
  'a11y-image-alt-decorative': {
    title: '{count} Bilder als Schmuckbilder markiert',
    text: 'Ein Screenreader überspringt solche Bilder. Zeigt eines davon etwas Wichtiges, etwa ein Produkt oder Ihr Team, tragen Sie dort einen kurzen Alternativtext ein.',
  },
  'a11y-manual-check': {
    title: '{names}: Barriere unklar',
    text: 'An einigen Stellen konnte die automatische Prüfung nicht entscheiden, ob eine Barriere besteht. Prüfen Sie diese Stellen von Hand oder mit einem Werkzeug wie WAVE.',
    group: {
      title: 'Barriere unklar: {names}',
      text: 'An einigen Stellen konnte die automatische Prüfung nicht entscheiden, ob eine Barriere besteht. Prüfen Sie diese Stellen von Hand oder mit einem Werkzeug wie WAVE.',
    },
  },
  'a11y-manual-check-contrast': {
    title: 'Kontrast an {count} Stellen unklar',
    text: 'Bei Text über einem Bild oder einem Farbverlauf kann die automatische Prüfung den Kontrast nicht messen. Prüfen Sie diese Stellen von Hand; oft hilft eine einfarbige, halbtransparente Fläche hinter dem Text.',
  },

  // Security.
  'security-https-manual': {
    title: 'Verschlüsselung unklar',
    text: 'Rufen Sie Ihre Seite mit https:// auf und prüfen Sie, ob der Browser die Verbindung als sicher anzeigt.',
  },
  'security-http-redirect-manual': {
    title: 'Weiterleitung auf https:// unklar',
    text: 'Fragen Sie Ihren Hoster, ob eine Weiterleitung von http:// auf https:// eingerichtet ist. Ein Test im eigenen Browser sagt wenig, weil manche Browser von sich aus auf https:// wechseln.',
  },
  'security-http-redirect-in-page': {
    title: 'Weiterleitung auf https:// erst im Browser',
    text: 'Nötig ist hier nichts. Sauberer ist eine dauerhafte Weiterleitung des Servers (Statuscode 301); bei vielen Hostern ist das eine Einstellung im Kundenbereich.',
  },
  'security-http-unavailable': {
    title: 'Unter http:// nicht erreichbar',
    text: 'Nötig ist hier nichts: Unverschlüsselt lässt sich Ihre Seite dann gar nicht aufrufen. Damit alte http://-Links nicht auf einer Fehlermeldung enden, können Sie eine Weiterleitung auf https:// einrichten.',
  },
  'security-headers': {
    title: 'Sicherheits-Header: Wirkung unklar',
    text: 'Bei mindestens einem Header konnten wir nicht feststellen, ob er wirkt. Lassen Sie die Header Ihrer Startseite von Ihrem Hoster oder Ihrer Agentur prüfen.',
  },
};

/** The singular of the titles with `{count}` (the drafts give a singular for 1). */
export const CHECK_TITLES_ONE: Partial<Record<TextId, string>> = {
  'a11y-image-alt-decorative': 'Ein Bild als Schmuckbild markiert',
  'a11y-manual-check-contrast': 'Kontrast an einer Stelle unklar',
};
