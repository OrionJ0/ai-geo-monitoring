const test = require('node:test');
const assert = require('node:assert/strict');

const SeoAuditExchangeService = require('../services/SeoAuditExchangeService');

function pageReport() {
  const failedCheck = {
    id: 'title',
    category: 'metadata',
    title: '页面标题',
    status: 'failed',
    severity: 'high',
    weight: 8,
    finding: '页面标题缺失',
    value: 'Title: 0 个',
    recommendation: '添加能够准确描述页面主题的标题。'
  };
  return {
    auditId: 42,
    mode: 'page',
    scoreVersion: '2026-07-23-v2',
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    checkedAt: '2026-07-23T03:00:00.000Z',
    statusCode: 200,
    durationMs: 320,
    score: 82,
    grade: 'good',
    summary: { total: 23, issues: 1, totalWeight: 125 },
    page: { title: '', htmlBytes: 2048 },
    categories: [{ key: 'metadata', title: '页面元信息', checks: [failedCheck] }],
    priorities: [failedCheck],
    platforms: [{ key: 'google', label: 'Google', status: 'missing' }],
    crawlerAccess: {
      targetPath: '/',
      crawlers: [{
        key: 'googlebot',
        token: 'Googlebot',
        category: 'search',
        status: 'allowed',
        affectsScore: true,
        matchedRule: 'Allow: /'
      }]
    }
  };
}

test('标准 CSV 以固定长表列导出，并可恢复内容等价的 SEO 报告', () => {
  const source = pageReport();

  const csv = SeoAuditExchangeService.buildCsv(source);
  const parsed = SeoAuditExchangeService.parseCsv(csv);

  assert.match(csv, /^\uFEFFschema_version,exported_at,source_audit_id,record_type,/);
  assert.match(csv, /seo_audit_report_v1/);
  assert.match(csv, /,report,/);
  assert.match(csv, /,check,/);
  assert.match(csv, /,platform,/);
  assert.match(csv, /,crawler,/);
  assert.equal(parsed.sourceAuditId, 42);
  assert.deepEqual(parsed.report, source);
});

test('旧版单页历史缺少 mode 时仍可导出并规范化为 page', () => {
  const legacy = pageReport();
  delete legacy.mode;

  const parsed = SeoAuditExchangeService.parseCsv(
    SeoAuditExchangeService.buildCsv(legacy)
  );

  assert.equal(parsed.report.mode, 'page');
  assert.deepEqual(parsed.report, { ...legacy, mode: 'page' });
});

test('回导报告保留原检测时间并创建新的导入时间', () => {
  const parsed = { sourceAuditId: 42, report: pageReport() };

  const imported = SeoAuditExchangeService.prepareImportedReport(
    parsed,
    () => new Date('2026-07-23T05:00:00.000Z')
  );

  assert.equal(imported.auditId, undefined);
  assert.equal(imported.source, 'imported');
  assert.equal(imported.sourceAuditId, 42);
  assert.equal(imported.sourceCheckedAt, '2026-07-23T03:00:00.000Z');
  assert.equal(imported.checkedAt, '2026-07-23T05:00:00.000Z');
  assert.equal(imported.summary.source, 'imported');
});

test('拒绝列结构不一致或版本不受支持的 CSV', () => {
  const csv = SeoAuditExchangeService.buildCsv(pageReport());

  assert.throws(
    () => SeoAuditExchangeService.parseCsv(csv.replace('schema_version', 'wrong_header')),
    (error) => error.code === 'CSV_HEADERS_INVALID'
  );
  assert.throws(
    () => SeoAuditExchangeService.parseCsv(csv.replaceAll('seo_audit_report_v1', 'seo_audit_report_v0')),
    (error) => error.code === 'CSV_VERSION_UNSUPPORTED'
  );
});

test('可见表格字段会防止电子表格公式注入', () => {
  const report = pageReport();
  report.categories[0].checks[0].title = '=WEBSERVICE("https://invalid.example")';

  const csv = SeoAuditExchangeService.buildCsv(report);

  assert.match(csv, /\t=WEBSERVICE/);
  assert.deepEqual(SeoAuditExchangeService.parseCsv(csv).report, report);
});

test('关键证据不足的 v4 报告可带空分数导出并原样回导', () => {
  const report = pageReport();
  report.scoreVersion = '2026-07-23-v4';
  report.scoreModel = 'technical-health-v4';
  report.score = null;
  report.grade = 'unknown';
  report.health = {
    score: null,
    status: 'unknown',
    unknownReasons: ['robots.txt 证据不足']
  };

  const parsed = SeoAuditExchangeService.parseCsv(
    SeoAuditExchangeService.buildCsv(report)
  );

  assert.equal(parsed.report.score, null);
  assert.equal(parsed.report.grade, 'unknown');
  assert.deepEqual(parsed.report.health.unknownReasons, ['robots.txt 证据不足']);
});
