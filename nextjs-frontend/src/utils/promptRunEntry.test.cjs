/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/prompts/page.tsx'), 'utf8');

test('single-question runs use an idempotent report-producing entry', () => {
  assert.match(source, /promptRunIdempotencyRef/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /\/api\/geo-projects\/\$\{runProjectId\}\/prompts\/\$\{record\.id\}\/run/);
  assert.match(source, /data\.report_url/);
  assert.match(source, /router\.push\(reportUrl\)/);
  assert.doesNotMatch(source, /runPrompt[\s\S]*router\.push\(`\/geo\/project-dashboard\?project_id=/);
});
