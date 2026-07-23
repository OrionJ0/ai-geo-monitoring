const SCHEMA_VERSION = 'seo_audit_report_v1';
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_CSV_ROWS = 20000;

const HEADERS = [
  'schema_version',
  'exported_at',
  'source_audit_id',
  'record_type',
  'record_order',
  'mode',
  'requested_url',
  'final_url',
  'page_url',
  'item_id',
  'category',
  'status',
  'severity',
  'weight',
  'score',
  'title',
  'finding',
  'fact',
  'recommendation',
  'status_code',
  'duration_ms',
  'crawler_token',
  'crawler_category',
  'affects_score',
  'matched_rule',
  'record_json'
];

class SeoAuditCsvError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SeoAuditCsvError';
    this.code = code;
    this.status = 400;
  }
}

function protectFormula(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `\t${text}` : text;
}

function unprotectFormula(value) {
  const text = String(value ?? '');
  return /^\t[=+\-@]/.test(text) ? text.slice(1) : text;
}

function csvEscape(value) {
  const text = protectFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvRows(csv) {
  const text = String(csv || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new SeoAuditCsvError('CSV_SYNTAX_ERROR', 'CSV 存在未闭合的引号');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value !== ''));
}

function dateValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function recordRow(report, exportedAt, type, order, record, extra = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    exported_at: exportedAt,
    source_audit_id: report.auditId ?? '',
    record_type: type,
    record_order: order,
    mode: report.mode || 'page',
    requested_url: report.requestedUrl || '',
    final_url: report.finalUrl || '',
    page_url: extra.pageUrl || '',
    item_id: extra.itemId || record?.id || record?.key || '',
    category: extra.category || record?.category || '',
    status: record?.status || '',
    severity: record?.severity || '',
    weight: record?.weight ?? '',
    score: extra.score ?? record?.score ?? '',
    title: record?.title || record?.label || '',
    finding: record?.finding || '',
    fact: record?.value || '',
    recommendation: record?.recommendation || '',
    status_code: record?.statusCode ?? '',
    duration_ms: record?.durationMs ?? '',
    crawler_token: record?.token || '',
    crawler_category: record?.categoryLabel || record?.category || '',
    affects_score: typeof record?.affectsScore === 'boolean' ? record.affectsScore : '',
    matched_rule: record?.matchedRule || '',
    record_json: JSON.stringify(record)
  };
}

function buildRows(report, exportedAt) {
  const rows = [];
  let order = 0;
  const add = (type, record, extra) => {
    order += 1;
    rows.push(recordRow(report, exportedAt, type, order, record, extra));
  };

  add('report', report, { score: report.score });
  const issues = report.mode === 'site' ? report.issues : report.priorities;
  (Array.isArray(issues) ? issues : []).forEach((issue) => add('issue', issue));

  (Array.isArray(report.categories) ? report.categories : []).forEach((category) => {
    (Array.isArray(category.checks) ? category.checks : []).forEach((check) => {
      add('check', check, { category: category.key || check.category });
    });
  });

  (Array.isArray(report.platforms) ? report.platforms : []).forEach((platform) => add('platform', platform));
  (Array.isArray(report.crawlerAccess?.crawlers) ? report.crawlerAccess.crawlers : [])
    .forEach((crawler) => add('crawler', crawler));

  (Array.isArray(report.pages) ? report.pages : []).forEach((page) => {
    add('page', page, { pageUrl: page.url, score: page.score });
    (Array.isArray(page.issues) ? page.issues : []).forEach((issue) => {
      add('page_issue', issue, { pageUrl: page.url });
    });
    (Array.isArray(page.crawlerAccess?.crawlers) ? page.crawlerAccess.crawlers : [])
      .forEach((crawler) => add('page_crawler', crawler, { pageUrl: page.url }));
  });
  return rows;
}

function normalizeExportReport(report) {
  if (
    report
    && typeof report === 'object'
    && !Array.isArray(report)
    && !report.mode
    && Array.isArray(report.categories)
  ) {
    return { ...report, mode: 'page' };
  }
  return report;
}

function buildCsv(report) {
  const normalizedReport = normalizeExportReport(report);
  validateReport(normalizedReport);
  const exportedAt = new Date().toISOString();
  const rows = buildRows(normalizedReport, exportedAt)
    .map((row) => HEADERS.map((header) => row[header] ?? ''));
  return `\uFEFF${[HEADERS, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')}`;
}

function validateReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new SeoAuditCsvError('INVALID_REPORT', 'CSV 中的报告数据无效');
  }
  if (!['page', 'site'].includes(report.mode)) {
    throw new SeoAuditCsvError('INVALID_REPORT', 'CSV 中的检测模式无效');
  }
  if (!report.requestedUrl || !report.finalUrl) {
    throw new SeoAuditCsvError('INVALID_REPORT', 'CSV 中缺少报告网址');
  }
  if (!Number.isInteger(report.score) || report.score < 0 || report.score > 100) {
    throw new SeoAuditCsvError('INVALID_REPORT', 'CSV 中的报告分数无效');
  }
  if (!report.summary || typeof report.summary !== 'object' || !dateValue(report.checkedAt)) {
    throw new SeoAuditCsvError('INVALID_REPORT', 'CSV 中缺少报告摘要或检测时间');
  }
  if (report.mode === 'page' && !Array.isArray(report.categories)) {
    throw new SeoAuditCsvError('INVALID_REPORT', '单页报告缺少检查项');
  }
  if (report.mode === 'site' && (!report.site || !Array.isArray(report.pages))) {
    throw new SeoAuditCsvError('INVALID_REPORT', '全站报告缺少页面数据');
  }
  return report;
}

function parseCsv(csv) {
  if (Buffer.byteLength(String(csv || ''), 'utf8') > MAX_CSV_BYTES) {
    throw new SeoAuditCsvError('CSV_TOO_LARGE', 'CSV 文件不能超过 10MB');
  }
  const table = parseCsvRows(csv);
  if (table.length < 2) throw new SeoAuditCsvError('CSV_EMPTY', 'CSV 没有可导入的报告数据');
  if (table.length - 1 > MAX_CSV_ROWS) {
    throw new SeoAuditCsvError('CSV_TOO_MANY_ROWS', 'CSV 数据行不能超过 20000 行');
  }
  if (table[0].length !== HEADERS.length || table[0].some((header, index) => header !== HEADERS[index])) {
    throw new SeoAuditCsvError('CSV_HEADERS_INVALID', 'CSV 列结构与 SEO 标准模板不一致');
  }

  const values = table.slice(1).map((row, rowIndex) => {
    if (row.length !== HEADERS.length) {
      throw new SeoAuditCsvError('CSV_ROW_INVALID', `CSV 第 ${rowIndex + 2} 行列数不正确`);
    }
    return Object.fromEntries(HEADERS.map((header, index) => [header, unprotectFormula(row[index])]));
  });
  if (values.some((row) => row.schema_version !== SCHEMA_VERSION)) {
    throw new SeoAuditCsvError('CSV_VERSION_UNSUPPORTED', 'CSV 版本不受支持');
  }
  const reportRows = values.filter((row) => row.record_type === 'report');
  if (reportRows.length !== 1) {
    throw new SeoAuditCsvError('CSV_REPORT_ROW_INVALID', 'CSV 必须且只能包含一条 report 记录');
  }

  let report;
  try {
    report = JSON.parse(reportRows[0].record_json);
  } catch {
    throw new SeoAuditCsvError('CSV_REPORT_JSON_INVALID', 'CSV 中的报告 JSON 无法解析');
  }
  validateReport(report);
  const sourceAuditId = Number(reportRows[0].source_audit_id);
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceAuditId: Number.isInteger(sourceAuditId) && sourceAuditId > 0 ? sourceAuditId : null,
    report
  };
}

function prepareImportedReport(parsed, now = () => new Date()) {
  const source = validateReport(parsed?.report);
  const { auditId: _auditId, ...report } = source;
  const importedAt = now().toISOString();
  return {
    ...report,
    source: 'imported',
    sourceAuditId: parsed.sourceAuditId,
    sourceCheckedAt: report.checkedAt,
    importedAt,
    checkedAt: importedAt,
    summary: {
      ...report.summary,
      source: 'imported'
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  HEADERS,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  SeoAuditCsvError,
  buildCsv,
  parseCsv,
  prepareImportedReport
};
