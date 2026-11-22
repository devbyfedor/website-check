import schemaJson from '../../schema/report.v1.schema.json' with { type: 'json' };

/**
 * A small validator for the subset of JSON Schema (draft 2020-12) that `scanner/schema/report.v1.schema.json`
 * uses. It runs in Node and in a Worker (no code generation, which Workers forbid), and it refuses a schema
 * with any keyword it does not implement, so the schema file can never rely on a check that silently does
 * not happen. A unit test compares its verdicts with Ajv, a full JSON Schema implementation.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json } | boolean;

const KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'maxProperties',
  'items',
  'minItems',
  'maxItems',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'oneOf',
  'anyOf',
]);

export interface SchemaError {
  /** JSON pointer of the value, for example `/findings/3/risk`. */
  path: string;
  message: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export interface CompiledSchema {
  validate(value: unknown): SchemaError[];
}

/** Checks the schema once (unknown keywords, broken references) and returns a validator. */
export function compileSchema(root: unknown): CompiledSchema {
  if (!isObject(root)) throw new Error('schema must be an object');
  const defs = isObject(root.$defs) ? root.$defs : {};
  const patterns = new Map<string, RegExp>();

  const resolve = (ref: string): Schema => {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
    const target = match === null ? undefined : defs[match[1] as string];
    if (target === undefined) throw new Error(`unsupported or unknown $ref ${ref}`);
    return target as Schema;
  };

  const check = (schema: unknown, where: string): void => {
    if (typeof schema === 'boolean') return;
    if (!isObject(schema)) throw new Error(`${where}: a schema must be an object or a boolean`);
    for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) throw new Error(`${where}: keyword "${key}" is not supported by validate.ts`);
    if (typeof schema.$ref === 'string') resolve(schema.$ref);
    if (typeof schema.pattern === 'string') patterns.set(schema.pattern, new RegExp(schema.pattern, 'u'));
    if (isObject(schema.properties)) for (const [name, sub] of Object.entries(schema.properties)) check(sub, `${where}/properties/${name}`);
    if (schema.additionalProperties !== undefined) check(schema.additionalProperties, `${where}/additionalProperties`);
    if (schema.items !== undefined) check(schema.items, `${where}/items`);
    for (const key of ['oneOf', 'anyOf'] as const) {
      const list = schema[key];
      if (list === undefined) continue;
      if (!Array.isArray(list)) throw new Error(`${where}/${key} must be an array`);
      list.forEach((sub, i) => check(sub, `${where}/${key}/${i}`));
    }
    if (isObject(schema.$defs)) for (const [name, sub] of Object.entries(schema.$defs)) check(sub, `${where}/$defs/${name}`);
  };
  check(root, '#');

  const validateAt = (schema: Schema, value: unknown, path: string, errors: SchemaError[]): void => {
    if (errors.length >= 50) return;
    if (schema === true) return;
    if (schema === false) {
      errors.push({ path, message: 'no value is allowed here' });
      return;
    }
    const fail = (message: string): void => {
      errors.push({ path: path === '' ? '/' : path, message });
    };
    if (typeof schema.$ref === 'string') validateAt(resolve(schema.$ref), value, path, errors);
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
      if (!types.some((t) => matchesType(value, t))) {
        fail(`expected ${types.join(' or ')}, got ${typeOf(value)}`);
        return;
      }
    }
    if (schema.const !== undefined && !deepEqual(value, schema.const)) fail(`must be ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(value, option))) fail(`must be one of ${JSON.stringify(schema.enum)}`);
    if (typeof value === 'number') {
      if (typeof schema.minimum === 'number' && value < schema.minimum) fail(`must be at least ${schema.minimum}`);
      if (typeof schema.maximum === 'number' && value > schema.maximum) fail(`must be at most ${schema.maximum}`);
      if (!Number.isFinite(value)) fail('must be a finite number');
    }
    if (typeof value === 'string') {
      const length = codePoints(value);
      if (typeof schema.minLength === 'number' && length < schema.minLength) fail(`must have at least ${schema.minLength} characters`);
      if (typeof schema.maxLength === 'number' && length > schema.maxLength) fail(`must have at most ${schema.maxLength} characters`);
      if (typeof schema.pattern === 'string' && !(patterns.get(schema.pattern) as RegExp).test(value)) fail(`must match ${schema.pattern}`);
    }
    if (Array.isArray(value)) {
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) fail(`must have at least ${schema.minItems} items`);
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} items`);
      if (schema.items !== undefined) value.forEach((item, i) => validateAt(schema.items as Schema, item, `${path}/${i}`, errors));
    }
    if (isObject(value)) {
      const properties = isObject(schema.properties) ? schema.properties : {};
      if (Array.isArray(schema.required)) for (const name of schema.required as string[]) if (!Object.hasOwn(value, name)) fail(`missing property "${name}"`);
      if (typeof schema.maxProperties === 'number' && Object.keys(value).length > schema.maxProperties) fail(`must have at most ${schema.maxProperties} properties`);
      for (const [name, item] of Object.entries(value)) {
        const sub = Object.hasOwn(properties, name) ? (properties[name] as Schema) : schema.additionalProperties;
        if (sub === undefined) continue;
        if (sub === false) fail(`property "${name}" is not allowed`);
        else validateAt(sub as Schema, item, `${path}/${name}`, errors);
      }
    }
    if (Array.isArray(schema.anyOf)) {
      const ok = (schema.anyOf as Schema[]).some((sub) => {
        const inner: SchemaError[] = [];
        validateAt(sub, value, path, inner);
        return inner.length === 0;
      });
      if (!ok) fail('matches none of the allowed forms (anyOf)');
    }
    if (Array.isArray(schema.oneOf)) {
      const passing = (schema.oneOf as Schema[]).filter((sub) => {
        const inner: SchemaError[] = [];
        validateAt(sub, value, path, inner);
        return inner.length === 0;
      }).length;
      if (passing !== 1) fail(passing === 0 ? 'matches none of the allowed forms (oneOf)' : `matches ${passing} forms, exactly one is allowed (oneOf)`);
    }
  };

  return {
    validate(value) {
      const errors: SchemaError[] = [];
      validateAt(root as Schema, value, '', errors);
      return errors;
    },
  };
}

/** The report schema of version 1, as stored in the repository. */
export const REPORT_SCHEMA_V1: unknown = schemaJson;

let compiled: CompiledSchema | null = null;

/** Validates a report against `scanner/schema/report.v1.schema.json`; an empty list means valid. */
export function validateReport(report: unknown): SchemaError[] {
  compiled ??= compileSchema(REPORT_SCHEMA_V1);
  return compiled.validate(report);
}
