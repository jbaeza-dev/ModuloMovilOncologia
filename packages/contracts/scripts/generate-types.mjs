import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// This deliberately emits a type, not a validator. All runtime constraints remain in JSON Schema.
const documents = [
  ['clinical', 'Clinical', 'openapi-clinico-rc32-bundle.json'],
  ['ai', 'Ai', 'openapi-ia-rc31.json'],
  ['gateway', 'Gateway', 'openapi-gateway-quimiocare-v1.json'],
  ['demo', 'Demo', 'openapi-simulador-control-v1.json'],
];
const base = new URL('../', import.meta.url);
const literal = (value) => JSON.stringify(value);
function typeOf(schema, prefix) {
  if (schema === true) return 'unknown';
  if (schema === false) return 'never';
  if (!schema || typeof schema !== 'object') return 'unknown';
  if (schema.$ref) {
    const local = '#/components/schemas/';
    if (!schema.$ref.startsWith(local))
      throw new Error(`Unsupported type reference: ${schema.$ref}`);
    return prefix + schema.$ref.slice(local.length);
  }
  if (Object.hasOwn(schema, 'const')) return literal(schema.const);
  if (schema.enum) return schema.enum.map(literal).join(' | ') || 'never';
  if (schema.anyOf || schema.oneOf)
    return '(' + (schema.anyOf || schema.oneOf).map((s) => typeOf(s, prefix)).join(' | ') + ')';
  if (schema.allOf && !schema.properties && !schema.type)
    return '(' + schema.allOf.map((s) => typeOf(s, prefix)).join(' & ') + ')';
  if (Array.isArray(schema.type))
    return schema.type.map((type) => typeOf({ ...schema, type }, prefix)).join(' | ');
  switch (schema.type) {
    case 'null':
      return 'null';
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `Array<${typeOf(schema.items, prefix)}>`;
    case 'object': {
      const properties = schema.properties || {};
      const required = new Set(schema.required || []);
      const fields = Object.entries(properties).map(
        ([key, value]) =>
          `  ${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${typeOf(value, prefix)};`,
      );
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        fields.push(`  [key: string]: ${typeOf(schema.additionalProperties, prefix)};`);
      if (!Object.keys(properties).length && schema.additionalProperties !== false)
        return 'Record<string, unknown>';
      return `{\n${fields.join('\n')}\n}`;
    }
    default:
      return 'unknown';
  }
}
for (const [service, prefix, file] of documents) {
  const doc = JSON.parse(readFileSync(new URL(`specs/${file}`, base), 'utf8'));
  const content =
    '// Generated from the unchanged upstream schemas. Run pnpm generate; do not edit.\n' +
    '// Numeric/string limits and conditional business constraints are checked at runtime.\n\n' +
    Object.entries(doc.components.schemas)
      .map(([name, schema]) => `export type ${prefix}${name} = ${typeOf(schema, prefix)};\n`)
      .join('\n');
  const out = new URL(`src/generated-${service}.ts`, base);
  if (process.argv.includes('--check')) {
    if (readFileSync(out, 'utf8') !== content)
      throw new Error(`Generated types drifted: ${fileURLToPath(out)}`);
  } else writeFileSync(out, content);
}
