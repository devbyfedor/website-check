import consentToolsJson from '../data/consent-tools.json' with { type: 'json' };
import googleDomainsJson from '../data/google-domains.json' with { type: 'json' };
import servicesJson from '../data/third-party-services.json' with { type: 'json' };
import { parseConsentToolsFile, type ConsentTool, type ConsentToolsFile } from './consent/tools.ts';
import { googleCanonicalHost, parseGoogleDomainsFile, type GoogleDomainsFile } from './domain/google.ts';
import { compileRules, parseRulesFile, type CompiledRules } from './rules/match.ts';
import type { RulesFile } from './rules/types.ts';

/** The rules data shipped with the scanner, validated at load time. */
export const RULES_FILE: RulesFile = parseRulesFile(servicesJson);
/** Google's country domains: www.google.it and www.google.de count as www.google.com. */
export const GOOGLE_DOMAINS_FILE: GoogleDomainsFile = parseGoogleDomainsFile(googleDomainsJson);
export const DEFAULT_RULES: CompiledRules = compileRules(RULES_FILE, { canonicalHost: googleCanonicalHost(GOOGLE_DOMAINS_FILE) });

export const CONSENT_TOOLS_FILE: ConsentToolsFile = parseConsentToolsFile(consentToolsJson);
export const DEFAULT_CONSENT_TOOLS: readonly ConsentTool[] = CONSENT_TOOLS_FILE.tools;
