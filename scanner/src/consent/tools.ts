/**
 * Consent tools (CMPs) that the capture recognises, best effort, to record when the consent
 * banner becomes visible. Data lives in `scanner/data/consent-tools.json`.
 *
 * Banner timing is extra information for the "Zeitschnitt A–A". It never decides a finding.
 */

export const CONSENT_TOOL_KINDS = ['saas', 'wordpress-plugin', 'platform-builtin', 'self-hosted-script'] as const;
export type ConsentToolKind = (typeof CONSENT_TOOL_KINDS)[number];

export interface ConsentTool {
  /** kebab-case, unique */
  id: string;
  name: string;
  kind: ConsentToolKind;
  /** CSS selectors of the banner or dialog root element in the top-level document */
  selectors: string[];
  /** The banner is drawn inside a shadow root of the matched element */
  shadowRoot: boolean;
  /** Ids of services in the rules data whose hosts belong to this tool (empty for self-hosted tools) */
  serviceIds: string[];
  /** Where the selectors come from (vendor docs, plugin source) */
  evidence: string[];
  note?: string;
}

export interface ConsentToolsFile {
  version: number;
  updated: string;
  tools: ConsentTool[];
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parseConsentToolsFile(raw: unknown): ConsentToolsFile {
  if (!isRecord(raw)) throw new Error('consent tools file: not an object');
  const errors: string[] = [];
  if (typeof raw['version'] !== 'number') errors.push('version must be a number');
  if (typeof raw['updated'] !== 'string') errors.push('updated must be a string');
  const tools = raw['tools'];
  if (!Array.isArray(tools) || tools.length === 0) throw new Error('consent tools file: tools must be a non-empty array');
  const ids = new Set<string>();
  tools.forEach((tool: unknown, index) => {
    const where = `tools[${index}]`;
    if (!isRecord(tool)) {
      errors.push(`${where}: not an object`);
      return;
    }
    const id = tool['id'];
    if (typeof id !== 'string' || !ID.test(id)) errors.push(`${where}: id must be kebab-case`);
    else if (ids.has(id)) errors.push(`${where}: duplicate id ${id}`);
    else ids.add(id);
    if (typeof tool['name'] !== 'string' || tool['name'] === '') errors.push(`${where}: name missing`);
    if (!(CONSENT_TOOL_KINDS as readonly unknown[]).includes(tool['kind'])) errors.push(`${where}: unknown kind`);
    if (!isStringArray(tool['selectors']) || tool['selectors'].length === 0) errors.push(`${where}: selectors must be a non-empty string array`);
    if (typeof tool['shadowRoot'] !== 'boolean') errors.push(`${where}: shadowRoot must be boolean`);
    if (!isStringArray(tool['serviceIds'])) errors.push(`${where}: serviceIds must be a string array`);
    if (!isStringArray(tool['evidence']) || tool['evidence'].length === 0) errors.push(`${where}: evidence must be a non-empty string array`);
  });
  if (errors.length > 0) throw new Error(`consent tools file has ${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  return raw as unknown as ConsentToolsFile;
}
