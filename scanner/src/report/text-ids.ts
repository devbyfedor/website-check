// Every text id the scanner can give (session texts-fix): the analyzers and the report builder name their texts only
// with these ids (the type `TextId`), so a unit test of web/ can check that each one has a text (docs/content-drafts.md,
// and the texts of the report page for the findings that can be among "Drei Dinge"). A new id is added here first.
// `fix-<service>` ids are not listed: they follow from the rules data (every known service of a class with a risk).

export const REPORT_TEXT_IDS = [
  // Third-party services: findings by risk class, and the hints.
  'third-party-precedent',
  'third-party-consent-required',
  'third-party-usually-consent',
  'third-party-frame-unknown',
  'third-party-unknown',
  'third-party-grey-zone',
  'third-party-unconfirmed',
  // Accessibility.
  'a11y-color-contrast',
  'a11y-image-alt',
  'a11y-label',
  'a11y-link-name',
  'a11y-button-name',
  'a11y-html-has-lang',
  'a11y-html-lang-valid',
  'a11y-image-alt-decorative',
  'a11y-manual-check',
  'a11y-manual-check-contrast',
  'a11y-not-checked',
  'a11y-check-not-checked',
  'a11y-frame-not-checked',
  // Security: HTTPS and the redirect (some only in the analysis, not in a report), the headers as one finding.
  'security-https-ok',
  'security-https-missing',
  'security-https-manual',
  'security-https-available',
  'security-http-redirect-ok',
  'security-http-no-redirect',
  'security-http-redirect-in-page',
  'security-http-redirect-manual',
  'security-http-unavailable',
  'security-http-redirect-not-checked',
  'security-headers',
  // The five headers, by status (`report.security.headers[].textId`).
  'security-header-hsts-missing',
  'security-header-hsts-invalid',
  'security-header-hsts-no-max-age',
  'security-header-hsts-duplicate',
  'security-header-csp-missing',
  'security-header-csp-invalid',
  'security-header-csp-report-only',
  'security-header-csp-manual',
  'security-header-csp-meta',
  'security-header-xcto-missing',
  'security-header-xcto-invalid',
  'security-header-referrer-policy-missing',
  'security-header-referrer-policy-invalid',
  'security-header-referrer-policy-manual',
  'security-header-referrer-policy-meta',
  'security-header-referrer-policy-weak',
  'security-header-permissions-policy-missing',
  'security-header-permissions-policy-invalid',
  'security-header-permissions-policy-legacy',
  'security-header-permissions-policy-open',
  'security-header-too-long',
  // Mandatory information.
  'legal-not-checked',
  'legal-impressum-no-link',
  'legal-impressum-no-link-empty-page',
  'legal-impressum-no-link-links-cut',
  'legal-impressum-no-link-quick',
  'legal-impressum-same-page',
  'legal-impressum-pdf',
  'legal-impressum-failed',
  'legal-impressum-not-checked',
  'legal-field-not-found',
  'legal-datenschutz-no-link',
  'legal-datenschutz-uncertain',
  'legal-accessibility-statement-uncertain',
  'legal-accessibility-statement-not-found',
  // A part of the scan that could not be analysed.
  'section-not-analysed',
  // The notice of the report (`report.notice.textId`).
  'report-page-almost-empty',
  'report-quick-incomplete',
  'report-blocked',
  'report-not-allowed',
  'report-failed',
] as const;

export type TextId = (typeof REPORT_TEXT_IDS)[number];

/**
 * The text ids of findings the builder gives a risk, so that they can be among "Drei Dinge" and get a card of their
 * own on the report page ("Was passiert", "Warum das wichtig ist", the steps). The builder (`scanner/src/report/build.ts`)
 * sets a risk only for: a third-party finding by its class, a failed accessibility check, HTTPS missing, no redirect to
 * https://, the security headers, and the Impressum link not found.
 */
export const PRIORITY_TEXT_IDS = [
  'third-party-precedent',
  'third-party-consent-required',
  'third-party-usually-consent',
  'a11y-color-contrast',
  'a11y-image-alt',
  'a11y-label',
  'a11y-link-name',
  'a11y-button-name',
  'a11y-html-has-lang',
  'a11y-html-lang-valid',
  'security-https-missing',
  'security-http-no-redirect',
  'security-headers',
  'legal-impressum-no-link',
] as const satisfies readonly TextId[];
