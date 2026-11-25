/**
 * Types of the rules data for third-party services (`scanner/data/third-party-services.json`).
 * The risk class of a service is data, not code; every class assignment has a source in
 * `docs/rules-sources.md`. No source means `grey-zone`.
 */

export const RISK_CLASSES = ['precedent', 'consent-required', 'usually-consent', 'grey-zone', 'not-flagged'] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

/** How a risk class is shown: as a finding, as a hint, or not at all. */
export type Severity = 'finding' | 'hint' | 'none';

export const SEVERITY_OF_RISK_CLASS: Readonly<Record<RiskClass, Severity>> = {
  precedent: 'finding',
  'consent-required': 'finding',
  'usually-consent': 'finding',
  'grey-zone': 'hint',
  'not-flagged': 'none',
};

export const SERVICE_CATEGORIES = [
  'fonts',
  'analytics',
  'tag-manager',
  'advertising',
  'social-pixel',
  'session-recording',
  'marketing-automation',
  'maps',
  'video',
  'chat',
  'reviews',
  'social-embed',
  'booking',
  'widget-platform',
  'cdn',
  'consent',
  'platform',
  'payment',
  'captcha',
  'accessibility-overlay',
  'translation',
  'other',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/**
 * Categories of infrastructure. Requests that such a service triggers belong to the service
 * they target, not to the infrastructure (a tag manager loads Google Analytics: both are listed).
 * Every other category is an embedded product: requests it triggers itself (for example
 * Google Fonts loaded by the Google Maps script) are attributed to that product.
 */
export const INFRASTRUCTURE_CATEGORIES: ReadonlySet<ServiceCategory> = new Set<ServiceCategory>([
  'fonts',
  'cdn',
  'platform',
  'consent',
  'tag-manager',
  'other',
]);

export const DATA_LOCATIONS = ['eu', 'us-possible', 'worldwide-cdn', 'unknown'] as const;
export type DataLocation = (typeof DATA_LOCATIONS)[number];

export interface ServiceRule {
  /** kebab-case, unique */
  id: string;
  /** Descriptive name for the rules documentation, e.g. "Google Tag Manager / Google tag (gtag.js)" */
  name: string;
  /**
   * The name the report shows (session B4 part 2, Fedor's answer 2): short, the brand as the brand writes it, without a
   * version the scan does not tell ("Google Analytics", not "Google Analytics 4"); a German word in brackets only where
   * one brand has several rules. Unique. Drafts (docs/content-drafts.md, "Session B4 part 2").
   */
  shortName: string;
  /** Short provider name, e.g. "Google" */
  provider: string;
  /** Legal entity for users in the EU, if known */
  providerLegal?: string;
  category: ServiceCategory;
  riskClass: RiskClass;
  dataLocation: DataLocation;
  /**
   * Host patterns: exact host (`fonts.gstatic.com`), any subdomain (`*.hotjar.com`, not the
   * apex itself), each optionally followed by a path prefix (`www.google.com/recaptcha/`).
   */
  hosts: string[];
  /** Ids of headings in `docs/rules-sources.md` */
  sources: string[];
  note?: string;
}

export interface RulesFile {
  version: number;
  /** Date of the last review, YYYY-MM-DD */
  updated: string;
  services: ServiceRule[];
}
