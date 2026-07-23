const SCHEMA_VERSION = 'question_set_run_v1';
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 5000;

const HEADERS = [
  'schema_version',
  'source_run_id',
  'question_set_name',
  'run_started_at',
  'run_completed_at',
  'record_id',
  'question_id',
  'question',
  'question_category',
  'platform',
  'platform_name',
  'model_name',
  'status',
  'error_message',
  'answer',
  'has_metrics',
  'brand_mentioned',
  'brand_mentions',
  'brand_rank',
  'brand_recommended',
  'share_of_voice',
  'citation_count',
  'sentiment',
  'sentiment_reason',
  'competitor_mentions_json',
  'citation_sources_json',
  'record_created_at',
  'record_updated_at'
];

class CsvValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CsvValidationError';
    this.code = code;
  }
}

function dateValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
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
  const text = typeof value === 'string' ? protectFormula(value) : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(report) {
  const rows = (Array.isArray(report?.rows) ? report.rows : []).map((row) => [
    SCHEMA_VERSION,
    report.id,
    report.question_set_name,
    dateValue(report.started_at),
    dateValue(report.completed_at),
    row.record_id ?? '',
    row.question_id ?? '',
    row.question,
    row.question_category,
    row.platform,
    row.platform_name,
    row.model_name,
    row.status,
    row.error_message,
    row.answer,
    Boolean(row.has_metrics),
    Boolean(row.brand_mentioned),
    Number(row.brand_mentions || 0),
    row.brand_rank ?? '',
    Boolean(row.brand_recommended),
    Number(row.share_of_voice || 0),
    Number(row.citation_count || 0),
    row.sentiment,
    row.sentiment_reason,
    JSON.stringify(Array.isArray(row.competitor_mentions) ? row.competitor_mentions : []),
    JSON.stringify(Array.isArray(row.citation_sources) ? row.citation_sources : []),
    dateValue(row.created_at),
    dateValue(row.updated_at)
  ]);
  return `\uFEFF${[HEADERS, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')}`;
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
  if (quoted) throw new CsvValidationError('CSV_SYNTAX_ERROR', 'CSV 存在未闭合的引号');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((cell) => String(cell).trim() !== ''));
}

function parseBoolean(value, column, line) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  throw new CsvValidationError('INVALID_FIELD', `第 ${line} 行 ${column} 不是有效布尔值`);
}

function parseNumber(value, column, line, { nullable = false } = {}) {
  if (value === '' && nullable) return null;
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    throw new CsvValidationError('INVALID_FIELD', `第 ${line} 行 ${column} 不是有效数字`);
  }
  return parsed;
}

function parseJsonArray(value, column, line) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) throw new Error('not-array');
    return parsed;
  } catch {
    throw new CsvValidationError('INVALID_FIELD', `第 ${line} 行 ${column} 不是有效 JSON 数组`);
  }
}

function parseCitationSources(value, line) {
  const sources = parseJsonArray(value, 'citation_sources_json', line);
  sources.forEach((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new CsvValidationError('INVALID_FIELD', `第 ${line} 行 citation_sources_json 包含无效来源`);
    }
    if (!source.url) return;
    try {
      const parsed = new URL(String(source.url));
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported-protocol');
    } catch {
      throw new CsvValidationError('INVALID_FIELD', `第 ${line} 行 citation_sources_json 包含非网页链接`);
    }
  });
  return sources;
}

function parseDate(value, column, line, { nullable = true } = {}) {
  if (!value && nullable) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CsvValidationError('INVALID_FIELD', `第 ${line} 行 ${column} 不是有效时间`);
  }
  return date;
}

function parseCsv(csv) {
  if (Buffer.byteLength(String(csv || ''), 'utf8') > MAX_CSV_BYTES) {
    throw new CsvValidationError('FILE_TOO_LARGE', 'CSV 文件不能超过 5MB');
  }
  const table = parseCsvRows(csv);
  if (table.length < 2) throw new CsvValidationError('EMPTY_FILE', 'CSV 至少需要一行报告数据');
  if (table.length - 1 > MAX_CSV_ROWS) {
    throw new CsvValidationError('TOO_MANY_ROWS', `CSV 不能超过 ${MAX_CSV_ROWS} 行数据`);
  }
  const headers = table[0].map((item) => String(item).trim());
  const missing = HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new CsvValidationError('MISSING_COLUMNS', `CSV 缺少必要列：${missing.join('、')}`);
  }
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  const valueAt = (row, column) => unprotectFormula(row[columnIndex.get(column)] ?? '');
  const allowedStatuses = new Set(['pending', 'completed', 'failed']);
  let questionSetName = '';
  let startedAt = null;
  let completedAt = null;

  const rows = table.slice(1).map((row, index) => {
    const line = index + 2;
    if (valueAt(row, 'schema_version') !== SCHEMA_VERSION) {
      throw new CsvValidationError('UNSUPPORTED_VERSION', `第 ${line} 行 schema_version 不受支持`);
    }
    const currentName = valueAt(row, 'question_set_name').trim();
    if (!currentName) throw new CsvValidationError('INVALID_FIELD', `第 ${line} 行缺少问题集名称`);
    if (questionSetName && questionSetName !== currentName) {
      throw new CsvValidationError('MIXED_REPORTS', '一个 CSV 只能包含同一次问题集报告的数据');
    }
    questionSetName = currentName;
    startedAt = startedAt || parseDate(valueAt(row, 'run_started_at'), 'run_started_at', line, { nullable: false });
    completedAt = completedAt || parseDate(valueAt(row, 'run_completed_at'), 'run_completed_at', line);
    const status = valueAt(row, 'status').trim();
    if (!allowedStatuses.has(status)) {
      throw new CsvValidationError('INVALID_FIELD', `第 ${line} 行 status 不受支持`);
    }
    return {
      record_id: parseNumber(valueAt(row, 'record_id'), 'record_id', line, { nullable: true }),
      question_id: parseNumber(valueAt(row, 'question_id'), 'question_id', line, { nullable: true }),
      question: valueAt(row, 'question'),
      question_category: valueAt(row, 'question_category'),
      platform: valueAt(row, 'platform'),
      platform_name: valueAt(row, 'platform_name'),
      model_name: valueAt(row, 'model_name'),
      status,
      error_message: valueAt(row, 'error_message'),
      answer: valueAt(row, 'answer'),
      has_metrics: parseBoolean(valueAt(row, 'has_metrics'), 'has_metrics', line),
      brand_mentioned: parseBoolean(valueAt(row, 'brand_mentioned'), 'brand_mentioned', line),
      brand_mentions: parseNumber(valueAt(row, 'brand_mentions'), 'brand_mentions', line),
      brand_rank: parseNumber(valueAt(row, 'brand_rank'), 'brand_rank', line, { nullable: true }),
      brand_recommended: parseBoolean(valueAt(row, 'brand_recommended'), 'brand_recommended', line),
      share_of_voice: parseNumber(valueAt(row, 'share_of_voice'), 'share_of_voice', line),
      citation_count: parseNumber(valueAt(row, 'citation_count'), 'citation_count', line),
      sentiment: valueAt(row, 'sentiment'),
      sentiment_reason: valueAt(row, 'sentiment_reason'),
      competitor_mentions: parseJsonArray(valueAt(row, 'competitor_mentions_json'), 'competitor_mentions_json', line),
      citation_sources: parseCitationSources(valueAt(row, 'citation_sources_json'), line),
      created_at: parseDate(valueAt(row, 'record_created_at'), 'record_created_at', line),
      updated_at: parseDate(valueAt(row, 'record_updated_at'), 'record_updated_at', line)
    };
  });

  return { schemaVersion: SCHEMA_VERSION, questionSetName, startedAt, completedAt, rows };
}

module.exports = {
  SCHEMA_VERSION,
  HEADERS,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  CsvValidationError,
  buildCsv,
  parseCsv
};
