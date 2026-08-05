import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const contractPath = path.join(
  repositoryRoot,
  'backend/modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json'
);
const outputPath = path.join(
  repositoryRoot,
  'nextjs-frontend/src/lib/marketing/generated/marketingAdReadApi.ts'
);
const document = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

function referencedName(reference) {
  const prefix = '#/components/schemas/';
  if (typeof reference !== 'string' || !reference.startsWith(prefix)) {
    throw new Error(`不支持的 OpenAPI 引用：${String(reference)}`);
  }
  return reference.slice(prefix.length);
}

function propertyName(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value)
    ? value
    : JSON.stringify(value);
}

function indent(value, spaces) {
  const padding = ' '.repeat(spaces);
  return value.split('\n').map((line) => `${padding}${line}`).join('\n');
}

function schemaType(schema) {
  if (!schema || typeof schema !== 'object') return 'unknown';
  if (schema.$ref) return referencedName(schema.$ref);
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map(schemaType).join(' | ');
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map(schemaType).join(' | ');
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => schemaType({ ...schema, type })).join(' | ');
  }
  if (schema.type === 'null') return 'null';
  if (schema.type === 'string') return 'string';
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'array') return `Array<${schemaType(schema.items)}>`;
  if (schema.type === 'object' || schema.properties) {
    const required = new Set(schema.required || []);
    const fields = Object.entries(schema.properties || {}).map(([name, value]) => (
      `${propertyName(name)}${required.has(name) ? '' : '?'}: ${schemaType(value)};`
    ));
    return fields.length ? `{\n${indent(fields.join('\n'), 2)}\n}` : 'Record<string, never>';
  }
  throw new Error(`不支持的 OpenAPI schema：${JSON.stringify(schema)}`);
}

const declarations = Object.entries(document.components?.schemas || {}).map(
  ([name, schema]) => `export type ${name} = ${schemaType(schema)};`
);
const output = [
  '/* 本文件由 goodieai-marketing-ad-read.openapi.json 自动生成；请勿手改。 */',
  '',
  ...declarations,
  ''
].join('\n');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, 'utf8')
    : '';
  if (current !== output) {
    process.stderr.write('营销广告 OpenAPI 前端 wire type 未生成或已过期。\n');
    process.exitCode = 1;
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
}
