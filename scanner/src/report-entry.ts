/**
 * The part of the scan core that the pages of `web/` need (session B2 part 2): the types of the report JSON and its
 * validator, which runs in the browser before a page shows anything of a report (`docs/report-schema.md`, "Strings
 * of the scanned page"). Nothing else: no rules data, no analyzers, no page scripts, no axe-core.
 */
export * from './report/types.ts';
export { validateReport, type SchemaError } from './report/validate.ts';
