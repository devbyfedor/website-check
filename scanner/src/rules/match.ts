import { hostOf, normalizeHost } from '../domain/site.ts';
import {
  DATA_LOCATIONS,
  RISK_CLASSES,
  SERVICE_CATEGORIES,
  type RulesFile,
  type ServiceRule,
} from './types.ts';

/**
 * Validation, compilation and matching of the third-party rules data.
 *
 * Matching precedence for a URL: exact host with the longest matching path prefix, then
 * exact host without path, then the most specific wildcard (`*.sub.example.com` before
 * `*.example.com`), again preferring the longest path prefix.
 *
 * Hosts can be mapped to a canonical host before matching (`canonicalHost`, for example a
 * Google country domain to google.com); the data then only names the canonical host.
 */

export interface HostPattern {
  /** The pattern as written in the data */
  raw: string;
  /** Host without the `*.` prefix */
  host: string;
  wildcard: boolean;
  /** Path prefix starting with `/`, or '' */
  pathPrefix: string;
}

export interface RuleMatch {
  rule: ServiceRule;
  pattern: HostPattern;
}

export interface CompiledRules {
  readonly services: readonly ServiceRule[];
  readonly byId: ReadonlyMap<string, ServiceRule>;
  /** Number of host patterns over all services */
  readonly patternCount: number;
  match(url: string): RuleMatch | null;
  /** The host that matching and grouping use (identity unless a mapping was given) */
  canonicalHost(host: string): string;
}

export interface CompileOptions {
  /** Maps a host to the host the rules name, e.g. `www.google.it` to `www.google.com` */
  canonicalHost?: (host: string) => string;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseHostPattern(raw: string): HostPattern {
  const slash = raw.indexOf('/');
  const hostPart = slash === -1 ? raw : raw.slice(0, slash);
  const pathPrefix = slash === -1 ? '' : raw.slice(slash);
  const wildcard = hostPart.startsWith('*.');
  const host = wildcard ? hostPart.slice(2) : hostPart;
  if (host !== normalizeHost(host) || !HOST.test(host)) {
    throw new Error(`invalid host in pattern "${raw}"`);
  }
  if (pathPrefix !== '' && (pathPrefix.length < 2 || /[\s?#*]/.test(pathPrefix))) {
    throw new Error(`invalid path prefix in pattern "${raw}"`);
  }
  return { raw, host, wildcard, pathPrefix };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Checks the raw JSON and returns it typed. Throws with a list of every problem found. */
export function parseRulesFile(raw: unknown): RulesFile {
  const errors: string[] = [];
  if (!isRecord(raw)) throw new Error('rules file: not an object');
  if (typeof raw['version'] !== 'number') errors.push('version must be a number');
  if (typeof raw['updated'] !== 'string' || !DATE.test(raw['updated'])) errors.push('updated must be YYYY-MM-DD');
  const services = raw['services'];
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error(`rules file: ${[...errors, 'services must be a non-empty array'].join('; ')}`);
  }
  const ids = new Set<string>();
  const patterns = new Map<string, string>();
  services.forEach((service: unknown, index) => {
    const where = `services[${index}]`;
    if (!isRecord(service)) {
      errors.push(`${where}: not an object`);
      return;
    }
    const id = service['id'];
    const label = typeof id === 'string' ? `${where} (${id})` : where;
    if (typeof id !== 'string' || !ID.test(id)) errors.push(`${label}: id must be kebab-case`);
    else if (ids.has(id)) errors.push(`${label}: duplicate id`);
    else ids.add(id);
    for (const key of ['name', 'provider'] as const) {
      const value = service[key];
      if (typeof value !== 'string' || value.trim() === '') errors.push(`${label}: ${key} must be a non-empty string`);
    }
    if (service['providerLegal'] !== undefined && typeof service['providerLegal'] !== 'string') {
      errors.push(`${label}: providerLegal must be a string`);
    }
    if (service['note'] !== undefined && typeof service['note'] !== 'string') errors.push(`${label}: note must be a string`);
    if (!(SERVICE_CATEGORIES as readonly unknown[]).includes(service['category'])) errors.push(`${label}: unknown category`);
    if (!(RISK_CLASSES as readonly unknown[]).includes(service['riskClass'])) errors.push(`${label}: unknown riskClass`);
    if (!(DATA_LOCATIONS as readonly unknown[]).includes(service['dataLocation'])) errors.push(`${label}: unknown dataLocation`);
    const sources = service['sources'];
    if (!isStringArray(sources) || sources.some((s) => !ID.test(s))) {
      errors.push(`${label}: sources must be an array of kebab-case ids`);
    } else if (service['riskClass'] !== 'grey-zone' && sources.length === 0) {
      errors.push(`${label}: risk class ${String(service['riskClass'])} needs at least one source (no source means grey-zone)`);
    }
    const hosts = service['hosts'];
    if (!isStringArray(hosts) || hosts.length === 0) {
      errors.push(`${label}: hosts must be a non-empty array of strings`);
      return;
    }
    for (const pattern of hosts) {
      try {
        parseHostPattern(pattern);
      } catch (error) {
        errors.push(`${label}: ${(error as Error).message}`);
        continue;
      }
      const owner = patterns.get(pattern);
      if (owner !== undefined) errors.push(`${label}: host pattern "${pattern}" is already used by ${owner}`);
      else patterns.set(pattern, typeof id === 'string' ? id : where);
    }
  });
  if (errors.length > 0) throw new Error(`rules file has ${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  return raw as unknown as RulesFile;
}

function pickByPath(entries: readonly RuleMatch[] | undefined, path: string): RuleMatch | null {
  if (entries === undefined) return null;
  let best: RuleMatch | null = null;
  for (const entry of entries) {
    if (entry.pattern.pathPrefix !== '' && !path.startsWith(entry.pattern.pathPrefix)) continue;
    if (best === null || entry.pattern.pathPrefix.length > best.pattern.pathPrefix.length) best = entry;
  }
  return best;
}

export function compileRules(file: RulesFile, options: CompileOptions = {}): CompiledRules {
  const canonicalHost = options.canonicalHost ?? ((host: string): string => host);
  const exact = new Map<string, RuleMatch[]>();
  const wildcard = new Map<string, RuleMatch[]>();
  let patternCount = 0;
  for (const rule of file.services) {
    for (const raw of rule.hosts) {
      const pattern = parseHostPattern(raw);
      const canonical = canonicalHost(pattern.host);
      if (canonical !== pattern.host) {
        throw new Error(`${rule.id}: host pattern "${raw}" is matched through ${canonical}; name that host instead`);
      }
      const index = pattern.wildcard ? wildcard : exact;
      const list = index.get(pattern.host) ?? [];
      list.push({ rule, pattern });
      index.set(pattern.host, list);
      patternCount += 1;
    }
  }
  const byId = new Map(file.services.map((rule) => [rule.id, rule]));

  function match(url: string): RuleMatch | null {
    const rawHost = hostOf(url);
    if (rawHost === null) return null;
    const host = canonicalHost(rawHost);
    let path = '/';
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
    const direct = pickByPath(exact.get(host), path);
    if (direct !== null) return direct;
    const labels = host.split('.');
    for (let i = 1; i < labels.length - 1; i += 1) {
      const found = pickByPath(wildcard.get(labels.slice(i).join('.')), path);
      if (found !== null) return found;
    }
    return null;
  }

  return { services: file.services, byId, patternCount, match, canonicalHost };
}
