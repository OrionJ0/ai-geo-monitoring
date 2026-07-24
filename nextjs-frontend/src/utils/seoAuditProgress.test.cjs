const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateSeoAuditProgressPercent } = require('./seoAuditProgress.cjs');

test('全站检测在持续发现新路由时进度百分比不会回退', () => {
  const snapshots = [
    { status: 'queued', progress: { phase: 'queued' } },
    { status: 'running', progress: { phase: 'running' } },
    { status: 'running', progress: { phase: 'discovering', discoveredPages: 1, auditedPages: 0 } },
    { status: 'running', progress: { phase: 'discovering', discoveredPages: 20, auditedPages: 0 } },
    { status: 'running', progress: { phase: 'crawling', discoveredPages: 20, auditedPages: 3 } },
    { status: 'running', progress: { phase: 'crawling', discoveredPages: 125, auditedPages: 3 } },
    { status: 'running', progress: { phase: 'crawling', discoveredPages: 125, auditedPages: 30 } },
    { status: 'completed', progress: { phase: 'completed', discoveredPages: 125, auditedPages: 125 } },
  ];
  const percentages = snapshots.map(({ status, progress }) => (
    calculateSeoAuditProgressPercent(progress, status)
  ));

  assert.equal(percentages.at(-1), 100);
  percentages.slice(1).forEach((percent, index) => {
    assert.ok(percent >= percentages[index], `${percentages[index]} -> ${percent}`);
  });
  assert.equal(percentages[4], percentages[5]);
});
