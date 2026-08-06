/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

test('browser API calls stay same-origin and Next always has a loopback backend target', () => {
  const axiosConfig = source('../lib/axiosConfig.js');
  const noticePage = source('../app/geo/notice/page.tsx');
  const nextConfig = source('../../next.config.ts');
  const envExample = source('../../.env.example');

  assert.match(axiosConfig, /axios\.defaults\.baseURL = ''/);
  assert.doesNotMatch(axiosConfig, /NEXT_PUBLIC_API|localhost:3002|127\.0\.0\.1:3002/);
  assert.match(noticePage, /from '@\/lib\/axiosConfig'/);
  assert.match(noticePage, /get\('\/api\/settings\/notice'/);
  assert.doesNotMatch(noticePage, /NEXT_PUBLIC_API|localhost:/);
  assert.match(nextConfig, /process\.env\.API_BASE_URL\s*\|\|\s*'http:\/\/127\.0\.0\.1:3002'/);
  assert.doesNotMatch(nextConfig, /NODE_ENV.*production.*undefined/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_API/);
  assert.match(envExample, /NEXT_PUBLIC_SITE_URL=\s*(?:\r?\n|$)/);
  assert.match(envExample, /API_BASE_URL=http:\/\/127\.0\.0\.1:3002/);
});

test('frontend development and production servers explicitly listen on all interfaces', () => {
  const packageJson = JSON.parse(source('../../package.json'));

  assert.match(packageJson.scripts.dev, /(?:^|\s)-(?:H|-hostname)\s+0\.0\.0\.0(?:\s|$)/);
  assert.match(packageJson.scripts.start, /(?:^|\s)-(?:H|-hostname)\s+0\.0\.0\.0(?:\s|$)/);
});

test('development server accepts the IPv4 loopback origin', () => {
  const nextConfig = source('../../next.config.ts');

  assert.match(
    nextConfig,
    /allowedDevOrigins:\s*\[[^\]]*['"]127\.0\.0\.1['"][^\]]*\]/s,
    '127.0.0.1 访问开发页时必须允许加载同源开发资源和 HMR',
  );
});

test('same-origin proxy covers the complete AI analysis retry budget', () => {
  const nextConfig = source('../../next.config.ts');
  const entityService = source('../../../backend/services/AIResponseEntityExtractionService.js');
  const semanticService = source('../../../backend/services/AIResponseSemanticJudgmentService.js');
  const coordinator = source('../../../backend/services/AIAnalysisExecutionCoordinator.js');
  const proxyTimeout = Number(nextConfig.match(/proxyTimeout:\s*([\d_]+)/)?.[1]?.replaceAll('_', ''));
  const timeoutSeconds = Number(entityService.match(/ANALYSIS_TIMEOUT_SECONDS\s*=\s*(\d+)/)?.[1]);
  const entityAttempts = Number(entityService.match(/ENTITY_MAX_ATTEMPTS\s*=\s*(\d+)/)?.[1]);
  const semanticAttempts = Number(semanticService.match(/SEMANTIC_MAX_ATTEMPTS\s*=\s*(\d+)/)?.[1]);
  const queueTimeoutMs = Number(coordinator.match(/MAX_QUEUE_TIMEOUT_MS\s*=\s*(\d+)/)?.[1]);

  assert.ok(Number.isFinite(proxyTimeout), 'Next.js 同源代理必须显式配置超时');
  assert.ok(
    proxyTimeout >= queueTimeoutMs + (timeoutSeconds * (entityAttempts + semanticAttempts) * 1000) + 10_000,
    '代理超时必须覆盖共享排队和 v5 两阶段全部分析尝试并保留响应开销',
  );
});
