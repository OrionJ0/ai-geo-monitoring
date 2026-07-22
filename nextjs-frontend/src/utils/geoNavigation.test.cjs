/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srcRoot = path.resolve(__dirname, '..');

test('legacy GEO routes redirect into the new project workspace routes', () => {
  const redirects = {
    'app/geo/page.tsx': '/geo/projects',
    'app/geo/dashboard/page.tsx': '/geo/project-dashboard',
    'app/geo/history/page.tsx': '/geo/project-dashboard',
    'app/geo/tasks/page.tsx': '/geo/project-dashboard'
  };

  Object.entries(redirects).forEach(([relativePath, target]) => {
    const source = fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');
    assert.match(source, new RegExp(`redirect\\('${target}'\\)`));
  });
});

test('GEO side navigation exposes only the new workspace modules plus notice and profile', () => {
  const source = fs.readFileSync(path.join(srcRoot, 'app/geo/layout.tsx'), 'utf8');
  const requiredRoutes = [
    '/geo/projects',
    '/geo/prompts',
    '/geo/project-dashboard',
    '/geo/seo-audit',
    '/geo/sources',
    '/geo/reports',
    '/geo/alerts',
    '/geo/notice',
    '/geo/profile'
  ];
  const forbiddenRoutes = ['/geo/dashboard', '/geo/history', '/geo/tasks'];

  requiredRoutes.forEach((route) => assert.match(source, new RegExp(route)));
  forbiddenRoutes.forEach((route) => assert.doesNotMatch(source, new RegExp(route)));
});
