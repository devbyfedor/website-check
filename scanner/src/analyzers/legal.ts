import type { Capture, PageSnapshot } from '../capture/types.ts';
import { firstPartySites, siteOfUrl } from '../domain/site.ts';
import { extractImpressumFields, fieldsNotChecked, type ImpressumFields } from '../legal/fields.ts';
import { chooseImpressumTarget, findLegalLinks, findLink, sameDocument, type LegalLinkMatch, type LegalLinks } from '../legal/links.ts';

/**
 * Mandatory information (session A4): the links to Impressum and Datenschutzerklärung on the
 * homepage, the Impressum fields (postal address, e-mail, Handelsregister, USt-IdNr), and a link to an
 * Erklärung zur Barrierefreiheit (homepage first, then the Impressum page). Pure function of a capture.
 *
 * Unsure means manual check (product rule 3): a link or field the scan does not find is "nicht
 * gefunden, bitte manuell prüfen", never "fehlt". The report decides the wording (stage B).
 */

export const LEGAL_ANALYSIS_VERSION = 1;

export type ImpressumState =
  /** The Impressum was opened in the second tab and its text searched. */
  | 'analyzed'
  /**
   * The Impressum link is an anchor on the homepage itself (a one-page site). The fields are not
   * searched: the homepage text holds more than the Impressum section.
   */
  | 'same-page'
  /** No Impressum link on the homepage. */
  | 'no-link'
  /** The link leads to a PDF, which the scan does not read. */
  | 'pdf'
  /** The second tab did not load the Impressum (timeout, HTTP error, check page, or it led back to the homepage). */
  | 'failed'
  /** The capture has no Impressum part (made before A4, the adapter did not open it, or the homepage text and links could not be read). */
  | 'not-captured';

export interface LegalAnalysis {
  version: typeof LEGAL_ANALYSIS_VERSION;
  /** False when the homepage's text and links could not be read: then no link counts as missing. */
  homepageRead: boolean;
  /** Links found on the homepage. */
  links: LegalLinks;
  impressum: {
    state: ImpressumState;
    /** The address the scan opened or would open. */
    url: string | null;
    finalUrl: string | null;
    /** The Impressum lies on another site than the homepage. */
    crossSite: boolean;
    /** Short English reason for `failed` and `not-captured`, for the local log. */
    reason: string | null;
  };
  fields: ImpressumFields;
  /**
   * The accessibility statement link: from the homepage, else from the Impressum page. `certain` false
   * means the link names only the topic: "bitte manuell prüfen", never "vorhanden".
   */
  accessibilityStatement: (LegalLinkMatch & { page: 'homepage' | 'impressum' }) | null;
}

export function analyzeLegal(capture: Capture): LegalAnalysis {
  const homepage = capture.page;
  const pageUrl = homepage?.url ?? capture.finalUrl;
  const own = firstPartySites(capture);
  if (homepage === null) {
    return {
      version: LEGAL_ANALYSIS_VERSION,
      homepageRead: false,
      links: { impressum: null, datenschutz: null, accessibilityStatement: null },
      impressum: { state: 'not-captured', url: null, finalUrl: null, crossSite: false, reason: 'the homepage text and links could not be read' },
      fields: fieldsNotChecked(),
      accessibilityStatement: null,
    };
  }
  const links = findLegalLinks(homepage.links, pageUrl);
  const target = chooseImpressumTarget(homepage.links, pageUrl);
  let state: ImpressumState;
  let url: string | null = null;
  let finalUrl: string | null = null;
  let reason: string | null = null;
  let text: PageSnapshot | null = null;
  switch (target.action) {
    case 'none':
      state = 'no-link';
      break;
    case 'same-page':
      state = 'same-page';
      url = target.link.href;
      finalUrl = pageUrl;
      break;
    case 'skip':
      state = 'pdf';
      url = target.link.href;
      break;
    case 'open': {
      url = target.url;
      const impressum = capture.impressum;
      if (impressum === undefined || impressum === null || !sameDocument(impressum.url, target.url)) {
        state = 'not-captured';
        reason = 'the capture has no Impressum tab for this link';
        break;
      }
      finalUrl = impressum.page?.url ?? impressum.finalUrl;
      if (!impressum.ok || impressum.page === null) {
        state = 'failed';
        reason = impressum.failure === null ? 'no text' : `${impressum.failure.reason}: ${impressum.failure.message.slice(0, 120)}`;
        break;
      }
      // A link that redirects back to the homepage (or a soft 404 that does) is not the Impressum.
      if (finalUrl !== null && pageUrl !== null && (sameDocument(finalUrl, pageUrl) || (capture.finalUrl !== null && sameDocument(finalUrl, capture.finalUrl)))) {
        state = 'failed';
        reason = 'the Impressum link led back to the homepage';
        break;
      }
      state = 'analyzed';
      text = impressum.page;
      break;
    }
  }
  const fields = text === null ? fieldsNotChecked() : extractImpressumFields(text.text, text.links);
  const impressumSite = finalUrl === null ? (url === null ? null : siteOfUrl(url)) : siteOfUrl(finalUrl);
  const crossSite = impressumSite !== null && !own.has(impressumSite);
  let accessibilityStatement: LegalAnalysis['accessibilityStatement'] = links.accessibilityStatement === null ? null : { ...links.accessibilityStatement, page: 'homepage' };
  if ((accessibilityStatement === null || !accessibilityStatement.certain) && state === 'analyzed' && text !== null) {
    const onImpressum = findLink('accessibilityStatement', text.links, finalUrl);
    if (onImpressum !== null && (accessibilityStatement === null || onImpressum.certain)) accessibilityStatement = { ...onImpressum, page: 'impressum' };
  }
  return {
    version: LEGAL_ANALYSIS_VERSION,
    homepageRead: true,
    links,
    impressum: { state, url, finalUrl, crossSite, reason },
    fields,
    accessibilityStatement,
  };
}
