const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../..');
const publicCopyFiles = [
  'README.md',
  'CONTEXT.md',
  'backend/services/AlertEvaluationService.js',
  'backend/services/OpportunityInsightService.js',
  'nextjs-frontend/src/app/geo/alerts/page.tsx',
  'nextjs-frontend/src/app/geo/project-dashboard/page.tsx',
  'nextjs-frontend/src/app/geo/prompts/page.tsx',
  'nextjs-frontend/src/app/geo/question-set-reports/page.tsx',
  'nextjs-frontend/src/app/geo/reports/page.tsx',
  'nextjs-frontend/src/app/geo/sources/page.tsx',
  'nextjs-frontend/src/components/WebCaptureEvidence.tsx',
  'nextjs-frontend/src/utils/reportCsv.cjs'
];

test('uses neutral citation terminology in all current user-facing copy', () => {
  for (const relativePath of publicCopyFiles) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /明确引用/, `${relativePath} 不应继续展示“明确引用”`);
  }
});

test('keeps the explicit_citation evidence role as an internal compatibility contract', () => {
  const service = fs.readFileSync(
    path.join(repositoryRoot, 'backend/services/CitationAnalysisService.js'),
    'utf8'
  );
  assert.match(service, /explicit_citation/);
});
