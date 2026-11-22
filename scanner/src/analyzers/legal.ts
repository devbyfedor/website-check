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
  /** The Impressum link is an anchor on the homepage: the homepage text was searched. */
  | 'same-page'
  /** No Impressum link on the homepage. */
  | 'no-link'
  /** The link leads to a PDF, which the scan does not read. */
  | 'pdf'
  /** The second tab did not load the Impressum (timeout, HTTP error, check page). */
  | 'failed'
  /** The capture has no Impressum part (made before A4, or the adapter did not open it). */
  | 'not-captured';

export interface LegalAnalysis {
  version: typeof LEGAL_ANALYSIS_VERSION;
  /** Links found on the homepage. */
  links: LegalLinks;
  impressum: {
    state: ImpressumState;
    /** The address the scan opened or would open. */
    url: string | null;
    finalUrl: string | null;
    /** The Impressum lies on another site than the homepage. */
    crossSite: boolean;
    /** Short English reason for `failed`, for the local log. */
    reason: string | null;
  };
  fields: ImpressumFields;
  /** The accessibility statement link: from the homepage, else from the Impressum page. */
  accessibilityStatement: (LegalLinkMatch & { page: 'homepage' | 'impressum' }) | null;
}

export function analyzeLegal(capture: Capture): LegalAnalysis {
  const homepage = capture.page;
  const pageUrl = capture.finalUrl;
  const links = findLegalLinks(homepage?.links ?? [], pageUrl);
  const target = chooseImpressumTarget(homepage?.links ?? [], pageUrl);
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
      text = homepage;
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
        break;
      }
      finalUrl = impressum.finalUrl;
      if (!impressum.ok || impressum.page === null) {
        state = 'failed';
        reason = impressum.failure === null ? 'no text' : `${impressum.failure.reason}: ${impressum.failure.message.slice(0, 120)}`;
        break;
      }
      state = 'analyzed';
      text = impressum.page;
      break;
    }
  }
  const fields = text === null ? fieldsNotChecked() : extractImpressumFields(text.text, text.links);
  const own = firstPartySites(capture);
  const impressumSite = finalUrl === null ? (url === null ? null : siteOfUrl(url)) : siteOfUrl(finalUrl);
  const crossSite = impressumSite !== null && !own.has(impressumSite);
  let accessibilityStatement: LegalAnalysis['accessibilityStatement'] = links.accessibilityStatement === null ? null : { ...links.accessibilityStatement, page: 'homepage' };
  if (accessibilityStatement === null && state === 'analyzed' && text !== null) {
    const onImpressum = findLink('accessibilityStatement', text.links, finalUrl);
    if (onImpressum !== null) accessibilityStatement = { ...onImpressum, page: 'impressum' };
  }
  return {
    version: LEGAL_ANALYSIS_VERSION,
    links,
    impressum: { state, url, finalUrl, crossSite, reason },
    fields,
    accessibilityStatement,
  };
}
