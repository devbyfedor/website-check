import type { CaptureFailureReason } from '../capture/types.ts';
import type { DataLocation, RiskClass, ServiceCategory, Severity } from '../rules/types.ts';

/**
 * The report JSON, version 1 (session A5): what the Durable Object stores after a scan and what the
 * report page of stage B renders. The machine-readable contract is `scanner/schema/report.v1.schema.json`;
 * `validateReport` checks a report against it. The mapping to `design/reference/bericht.html` element by
 * element is in `docs/report-schema.md`.
 *
 * The report holds facts, states and text ids with parameters, never finished German sentences: the texts
 * live in the repository (`docs/content-drafts.md` until stage B moves them into the app), so no text is
 * generated at runtime. All times are milliseconds since the start of the homepage capture; dates are ISO
 * 8601 in UTC.
 *
 * A change that an older renderer cannot read raises `REPORT_SCHEMA_VERSION` and gets a new schema file.
 */

export const REPORT_SCHEMA_VERSION = 1;

/** Caps that keep a report small: the Worker returns it without parsing, and one D1 row holds at most 2 MB. */
export const REPORT_LIMITS = {
  /** Serialized report, in UTF-16 code units of `JSON.stringify` (about bytes for this mostly ASCII data). */
  maxReportChars: 400_000,
  findings: 60,
  evidencePerFinding: 5,
  services: 80,
  hostsPerService: 10,
  timelineRows: 12,
  /** Rows of the D1 table `network_requests` per scan: one per host. */
  networkHosts: 100,
  urlLength: 300,
  htmlLength: 200,
  textLength: 300,
} as const;

/**
 * - `complete`: the full check with the browser; every section that could run is filled.
 * - `quick`: the daily browser limit was reached, only the quick check without a browser ran (HTML source
 *   and headers). The report is incomplete: "Die vollständige Prüfung ist morgen wieder möglich."
 * - `blocked`: the site refused the scan (bot protection, a check page, 401/403/429). No findings.
 * - `not-allowed`: the address, a redirect or a navigation was refused by the SSRF protection. No findings.
 * - `failed`: the homepage could not be loaded (timeout, unreachable, HTTP error, invalid address). No findings.
 */
export const REPORT_STATES = ['complete', 'quick', 'blocked', 'not-allowed', 'failed'] as const;
export type ReportState = (typeof REPORT_STATES)[number];

export type SectionId = 'thirdParty' | 'accessibility' | 'security' | 'legal' | 'platform';

export interface SectionStatus {
  status: 'checked' | 'not-checked';
  /** Why not checked: `quick-check` (no browser), `page-not-loaded`, or a short English reason of the analyzer. */
  reason: string | null;
}

export type FindingArea = 'privacy' | 'mandatory-information' | 'accessibility' | 'security';

/**
 * - `finding`: a technical fact with a general risk.
 * - `manual`: the scan is unsure: "nicht gefunden, bitte manuell prüfen" or "bitte manuell prüfen" (product rule 3).
 * - `hint`: shown as a hint, never as a violation (grey zone, or a request that never reached the server).
 * - `not-checked`: the check could not run (for example axe did not finish).
 */
export type FindingKind = 'finding' | 'manual' | 'hint' | 'not-checked';

/** General risk for the plan "Drei Dinge sollten Sie zuerst beheben" (hohes, mittleres, niedriges Risiko); null for hints and checks that did not run. */
export type FindingRisk = 'high' | 'medium' | 'low';

export type TextParam = string | number | boolean | null;

export type Evidence =
  | {
      type: 'request';
      url: string;
      startMs: number;
      status: number | null;
      reachedServer: boolean;
      /** Null when the banner time is unknown; extra information only. */
      beforeBanner: boolean | null;
      /** The iframe or script that made the request, when it was attributed through one. */
      via: string | null;
    }
  | {
      type: 'element';
      /** Selector path, one entry per document or open shadow root. */
      target: string[];
      html: string;
      /** Contrast examples only. */
      ratio: number | null;
      expected: string | null;
    }
  | { type: 'header'; name: string; status: string; value: string | null };

export interface Finding {
  /** Stable within the report and between reports of the same site, for example `third-party:google-fonts` or `a11y:color-contrast`. */
  id: string;
  area: FindingArea;
  kind: FindingKind;
  risk: FindingRisk | null;
  /** Text id in `docs/content-drafts.md` (title, fact and risk, fix). */
  textId: string;
  /** Placeholders of the text, for example `count`, `ratio`, `expected`, `provider`. */
  params: Record<string, TextParam>;
  /**
   * The cell of the homepage plan ("Feld B2": columns A to D, rows 1 to 3). Null: the capture does not
   * record where the element is yet (see `docs/report-schema.md`).
   */
  field: string | null;
  /** Third-party findings: the key of the service in `services`. */
  serviceKey: string | null;
  /**
   * Data went to a third party before consent (a request of the service got an answer): the report names
   * the country of the visit next to it. False for services whose requests never reached the server.
   */
  beforeConsent: boolean;
  evidence: Evidence[];
  /** Text id of the fix instructions with system tabs ("Montageanleitung"); null when there is none. */
  fixTextId: string | null;
}

export type MeasureId =
  | 'third-party-before-consent'
  | 'impressum-fields'
  | 'lowest-contrast'
  | 'images-described'
  | 'accessibility-statement'
  | 'https'
  | 'security-headers';

export type MeasureResult = 'pass' | 'fail' | 'partial' | 'manual' | 'not-checked';

export type MeasureValue =
  | { type: 'count'; count: number }
  | { type: 'of'; count: number; total: number }
  | { type: 'ratio'; ratio: number; expected: string | null }
  | { type: 'all' }
  | { type: 'state'; state: 'present' | 'found' | 'uncertain' | 'not-found' | 'https' | 'http' | 'unknown' };

/** One row of the "Prüfmaße" table: Merkmal, Soll, Ist, Ergebnis. */
export interface Measure {
  id: MeasureId;
  result: MeasureResult;
  target: MeasureValue;
  /** Null when the check did not run. */
  actual: MeasureValue | null;
}

/** One row of the "Stückliste der fremden Dienste". */
export interface ReportService {
  /** "Pos." */
  position: number;
  /** Rules id, or `unknown:<registrable domain>`. */
  key: string;
  known: boolean;
  name: string;
  provider: string | null;
  category: ServiceCategory | 'unknown';
  riskClass: RiskClass;
  dataLocation: DataLocation;
  severity: Severity;
  /**
   * The tag in the column "Einwilligung": `missing` (fehlt), `grey-zone` (Graubereich), `not-needed` (not
   * flagged), `not-reached` (no request of the service got an answer, so no data is known to have arrived;
   * not in the design), `manual` (session fix-a1: the requests reached the service, but the scan cannot tell
   * whether the page itself or an embedded third-party page made them: "bitte manuell prüfen"; not in the design;
   * session fix-a2: also every service that would be `missing` on an almost empty page).
   */
  consent: 'missing' | 'grey-zone' | 'not-needed' | 'not-reached' | 'manual';
  /** "Startet": every request of the scan happened without consent, because the scan never clicks. */
  starts: 'before-consent';
  requestCount: number;
  firstStartMs: number;
  startsBeforeBanner: boolean | null;
  hosts: string[];
  /** Ids of headings in `docs/rules-sources.md`. */
  sources: string[];
  findingId: string | null;
}

export interface TimelineRow {
  /** Host, or host and the common first path part of the site's own files (`example.de/wp-content`). */
  label: string;
  party: 'own' | 'third';
  /** document: the homepage itself; files: the site's own files; consent-tool; service: a third party. */
  kind: 'document' | 'files' | 'consent-tool' | 'service';
  serviceKey: string | null;
  provider: string | null;
  startMs: number;
  /** End of the last request of the row that started in the window; null if it was still open. */
  endMs: number | null;
  requestCount: number;
  beforeBanner: boolean | null;
}

/** "Zeitschnitt A–A: die ersten drei Sekunden". */
export interface Timeline {
  windowMs: number;
  /** The cut A–A; null when no banner was seen. Never the basis of a finding. */
  bannerVisibleAtMs: number | null;
  bannerToolId: string | null;
  rows: TimelineRow[];
  rowsTruncated: boolean;
}

export type FieldState = { status: 'found'; quote: string } | { status: 'not-found'; reason: 'not-on-page' | 'impressum-not-checked' };

export interface ReportLegal {
  impressumLink: { href: string; text: string } | null;
  datenschutzLink: { href: string; text: string } | null;
  /** `certain` false: the link names only the topic ("bitte prüfen, ob es die Erklärung ist"). */
  accessibilityStatement: { href: string; text: string; certain: boolean; page: 'homepage' | 'impressum' } | null;
  impressum: { state: 'analyzed' | 'same-page' | 'no-link' | 'pdf' | 'failed' | 'not-captured'; url: string | null; crossSite: boolean };
  fields: { address: FieldState; email: FieldState; handelsregister: FieldState; ustId: FieldState };
}

export interface ReportSecurity {
  https: 'pass' | 'fail' | 'manual';
  httpRedirect: 'pass' | 'fail' | 'manual' | 'info' | 'not-checked';
  headers: { key: string; header: string; status: string; counts: boolean; value: string | null; textId: string | null }[];
  headersPresent: number;
  headersTotal: number;
}

export interface ReportV1 {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  /** The scan id: random, 26 characters of base32 (128 bits), never guessable. */
  id: string;
  /** When the visitor started the scan. */
  createdAt: string;
  state: ReportState;
  site: {
    /** The normalized address the visitor asked for (scheme, host, "/"). */
    url: string;
    /** Host in ASCII (punycode for umlaut domains). */
    host: string;
    /** For the head and the title block: Unicode, without a leading "www.". */
    displayHost: string;
    /** Address of the homepage after all redirects; null when it did not load. */
    finalUrl: string | null;
  };
  scan: {
    mode: 'full' | 'quick';
    /** "Geprüft am": start of the homepage capture. */
    scannedAt: string | null;
    durationMs: number | null;
    scannerVersion: string;
    rulesUpdated: string;
    axeVersion: string | null;
  };
  /** Where the site was visited from. The report names the country in its head and next to every finding about data sent before consent. */
  visit: {
    /** ISO 3166 country of the browser (Cloudflare `loc`), null when unknown (for example a local run). */
    country: string | null;
    /** Cloudflare data center of the browser (`colo`), null when unknown. */
    colo: string | null;
    adapter: string;
    browser: string | null;
    locale: string;
    timezone: string;
    viewport: { width: number; height: number };
  };
  /**
   * Text id of the notice for a state other than `complete` (quick check, blocked, not allowed, failed). For
   * `complete` it is null, except `report-page-almost-empty` (session fix-a1): the page showed almost nothing
   * and may have been a page of bot protection; such a report has no findings and no hints, and its measures
   * are `manual` (session fix-a2).
   */
  notice: { textId: string; params: Record<string, TextParam> } | null;
  failure: { reason: CaptureFailureReason; status: number | null } | null;
  /** "Geprüfte Seiten": Startseite and Impressum. */
  pages: { homepage: 'checked' | 'not-checked'; impressum: 'checked' | 'not-checked' };
  /** "Revision A, Erstprüfung". Revisions are built in stage D; until then every report is revision A. */
  revision: { letter: 'A'; kind: 'initial' };
  sections: Record<SectionId, SectionStatus>;
  /** "System": the detected system decides the selected tab of the fix instructions. */
  platform: {
    system: 'wordpress' | 'shopify' | 'shopware' | 'wix' | 'jimdo' | 'unknown';
    woocommerce: boolean;
    shopwareVersion: 5 | 6 | null;
    /** True for shop systems (WooCommerce, Shopify, Shopware); null when the scan cannot tell. */
    shop: boolean | null;
  } | null;
  measures: Measure[];
  /** Ordered by priority (kind, risk, area, time). */
  findings: Finding[];
  /** "Drei Dinge sollten Sie zuerst beheben": ids of at most three findings with a risk. */
  priorities: string[];
  services: ReportService[];
  timeline: Timeline | null;
  legal: ReportLegal | null;
  security: ReportSecurity | null;
  counts: { findings: number; manual: number; hints: number; notChecked: number; services: number };
}

export type Report = ReportV1;
