const assert = require('node:assert/strict');

const Ajv2020Module = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const openApi = require(
  '../../../modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json'
);

const Ajv2020 = Ajv2020Module.default || Ajv2020Module;
const ajv = new Ajv2020({
  allErrors: true,
  strict: true
});
addFormats(ajv);

const validators = new Map();

function rewriteSchemaRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteSchemaRefs);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (
      key === '$ref'
      && typeof entry === 'string'
      && entry.startsWith('#/components/schemas/')
    ) {
      return ['$ref', entry.replace('#/components/schemas/', '#/$defs/')];
    }
    return [key, rewriteSchemaRefs(entry)];
  }));
}

function resolveResponse(response) {
  if (!response?.$ref) return response;
  const prefix = '#/components/responses/';
  assert.ok(
    response.$ref.startsWith(prefix),
    `不支持的 OpenAPI response 引用：${response.$ref}`
  );
  return openApi.components.responses[response.$ref.slice(prefix.length)];
}

function compileResponseValidator(path, status) {
  const cacheKey = `${path}#${status}`;
  if (validators.has(cacheKey)) return validators.get(cacheKey);

  const operation = openApi.paths[path]?.get;
  assert.ok(operation, `OpenAPI 未声明 GET ${path}`);
  const response = resolveResponse(operation.responses[String(status)]);
  assert.ok(response, `OpenAPI 未声明 ${path} 的 ${status} 响应`);
  const responseSchema = response.content?.['application/json']?.schema;
  assert.ok(responseSchema, `OpenAPI 未声明 ${path} ${status} 的 JSON schema`);

  const validator = ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: rewriteSchemaRefs(openApi.components.schemas),
    ...rewriteSchemaRefs(responseSchema)
  });
  validators.set(cacheKey, validator);
  return validator;
}

function assertMarketingOpenApiResponse({ path, status, payload }) {
  const validator = compileResponseValidator(path, status);
  if (validator(payload)) return;
  const details = validator.errors.map((error) => (
    `${error.instancePath || '/'} ${error.message}`
  )).join('; ');
  throw new assert.AssertionError({
    message: `OpenAPI 响应不匹配：${path} ${status}：${details}`,
    actual: payload,
    expected: '符合 goodieai-marketing-ad-read.openapi.json'
  });
}

module.exports = {
  assertMarketingOpenApiResponse
};
