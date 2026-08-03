const SCHEMA_VERSION = 'consultation_records_v1';
const TIME_ZONE = 'Asia/Shanghai';

const CONSULTATION_TYPES = Object.freeze([
  'WEBSITE_FORM',
  'ONLINE_CHAT'
]);
const SOURCE_SYSTEMS = Object.freeze(['GATO_WEBSITE', 'KF53']);
const SOURCE_STATES = Object.freeze([
  'AVAILABLE',
  'PARTIAL',
  'AGGREGATE_ONLY',
  'NOT_CONNECTED',
  'ERROR'
]);
const RECORD_COVERAGE = Object.freeze(['FULL', 'PARTIAL', 'NONE']);
const DEVICES = Object.freeze(['PC', 'MOBILE', 'OTHER', 'UNKNOWN']);
const SORT_FIELDS = Object.freeze([
  'occurredAt',
  'consultationType',
  'source'
]);
const MAX_FORM_FIELDS = 100;
const MAX_CONVERSATION_MESSAGES = 500;
const MAX_DETAIL_TEXT_CHARS = 200000;

class ConsultationRecordError extends Error {
  constructor(message, code, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function fail(message, code = 'CONSULTATION_RECORD_RESPONSE_INVALID') {
  throw new ConsultationRecordError(message, code, 502);
}

function strictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function parsePositiveInteger(value, fallback, maximum, field) {
  const candidate = value === undefined ? String(fallback) : String(value);
  if (!/^\d+$/u.test(candidate)) {
    throw new ConsultationRecordError(
      `${field} 参数无效`,
      'CONSULTATION_RECORD_QUERY_INVALID',
      422
    );
  }
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ConsultationRecordError(
      `${field} 参数无效`,
      'CONSULTATION_RECORD_QUERY_INVALID',
      422
    );
  }
  return parsed;
}

function enumValue(value, allowed, fallback, field) {
  const candidate = String(value === undefined ? fallback : value);
  if (!allowed.includes(candidate)) {
    throw new ConsultationRecordError(
      `${field} 参数无效`,
      'CONSULTATION_RECORD_QUERY_INVALID',
      422
    );
  }
  return candidate;
}

function responseEnum(value, allowed, field) {
  const candidate = String(value || '');
  if (!allowed.includes(candidate)) fail(`${field} 字段无效`);
  return candidate;
}

function normalizeListQuery(query = {}) {
  const from = String(query.from || '');
  const to = String(query.to || '');
  if (!strictDate(from) || !strictDate(to) || from > to) {
    throw new ConsultationRecordError(
      '咨询记录日期范围无效',
      'CONSULTATION_RECORD_DATE_RANGE_INVALID',
      422
    );
  }
  const days = (
    Date.parse(`${to}T00:00:00.000Z`)
    - Date.parse(`${from}T00:00:00.000Z`)
  ) / 86400000 + 1;
  if (days > 180) {
    throw new ConsultationRecordError(
      '咨询记录日期范围超过 180 天',
      'CONSULTATION_RECORD_DATE_RANGE_TOO_LARGE',
      422
    );
  }
  const search = String(query.q || '').trim();
  if (search.length > 100 || /[\u0000-\u001f\u007f]/u.test(search)) {
    throw new ConsultationRecordError(
      'q 参数无效',
      'CONSULTATION_RECORD_QUERY_INVALID',
      422
    );
  }
  const source = String(query.source || 'ALL').trim();
  if (
    source !== 'ALL'
    && !/^[A-Z][A-Z0-9_]{0,63}$/u.test(source)
  ) {
    throw new ConsultationRecordError(
      'source 参数无效',
      'CONSULTATION_RECORD_QUERY_INVALID',
      422
    );
  }
  return {
    from,
    to,
    page: parsePositiveInteger(query.page, 1, 1000000, 'page'),
    pageSize: parsePositiveInteger(query.pageSize, 10, 100, 'pageSize'),
    type: enumValue(
      query.type,
      ['ALL', ...CONSULTATION_TYPES],
      'ALL',
      'type'
    ),
    source,
    device: enumValue(
      query.device,
      ['ALL', ...DEVICES],
      'ALL',
      'device'
    ),
    q: search,
    sortBy: enumValue(query.sortBy, SORT_FIELDS, 'occurredAt', 'sortBy'),
    sortOrder: enumValue(query.sortOrder, ['asc', 'desc'], 'desc', 'sortOrder')
  };
}

function boundedString(value, field, maximum, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) {
    return null;
  }
  if (typeof value !== 'string') fail(`${field} 字段无效`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) fail(`${field} 字段无效`);
  return normalized;
}

function maskEmail(value) {
  const cleaned = value.replace(/\*+$/u, '');
  const at = cleaned.lastIndexOf('@');
  if (at <= 0 || at === cleaned.length - 1) return '[邮箱已脱敏]';
  const local = cleaned.slice(0, at).replace(/\*/gu, '');
  const domain = cleaned.slice(at + 1);
  if (!local || !/^[A-Za-z0-9.-]+$/u.test(domain)) return '[邮箱已脱敏]';
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(value) {
  const digits = value.replace(/\D/gu, '');
  if (digits.length < 7) return value.includes('*') ? value : '[电话已脱敏]';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function maskDisplayName(value) {
  const visible = [...value].filter((character) => (
    character !== '*' && !/\s/u.test(character)
  ));
  return visible.length > 0 ? `${visible[0]}**` : null;
}

function sanitizePublicText(value, field, maximum, options = {}) {
  let normalized = boundedString(value, field, maximum, options);
  if (normalized === null) return null;
  normalized = normalized
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '[IP 已脱敏]')
    .replace(/\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/gu, '[IP 已脱敏]')
    .replace(/\b\d{17}[\dXx]\b/gu, '[身份证已脱敏]')
    .replace(/(?:QQ|qq|微信(?:号)?|wechat)\s*[:：]?\s*[A-Za-z0-9_-]{5,32}/giu, '[社交账号已脱敏]')
    .replace(/(?:地址|住址|收货地址)\s*[:：]\s*[^，,；;\n]{3,120}/gu, '[地址已脱敏]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, (email) => (
      maskEmail(email)
    ))
    .replace(/\b0\d{2,3}[-\s]?\d{7,8}\b/gu, '[座机已脱敏]')
    .replace(/(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}/gu, (phone) => (
      maskPhone(phone)
    ))
    .replace(/\+[1-9]\d(?:[\s().-]?\d){8,14}/gu, (phone) => (
      maskPhone(phone)
    ));
  return boundedString(normalized, field, maximum, options);
}

function isoDateTime(value, field) {
  const normalized = boundedString(value, field, 40);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail(`${field} 字段无效`);
  }
  return normalized;
}

function maskedContact(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('maskedContact 字段无效');
  }
  const displayName = sanitizePublicText(
    value.displayName,
    'maskedContact.displayName',
    40,
    { nullable: true }
  );
  const phone = sanitizePublicText(
    value.phone,
    'maskedContact.phone',
    40,
    { nullable: true }
  );
  const email = sanitizePublicText(
    value.email,
    'maskedContact.email',
    120,
    { nullable: true }
  );
  return {
    displayName: displayName ? maskDisplayName(displayName) : null,
    phone: phone ? maskPhone(phone) : null,
    email: email ? maskEmail(email) : null
  };
}

function normalizeSourceStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('来源状态无效');
  }
  const sourceSystem = responseEnum(
    value.sourceSystem,
    SOURCE_SYSTEMS,
    'sourceSystem'
  );
  const consultationType = responseEnum(
    value.consultationType,
    CONSULTATION_TYPES,
    'consultationType'
  );
  const expected = sourceSystem === 'GATO_WEBSITE'
    ? 'WEBSITE_FORM'
    : 'ONLINE_CHAT';
  if (consultationType !== expected) fail('来源系统与咨询类型不一致');
  const sourceState = responseEnum(
    value.sourceState,
    SOURCE_STATES,
    'sourceState'
  );
  const recordCoverage = responseEnum(
    value.recordCoverage,
    RECORD_COVERAGE,
    'recordCoverage'
  );
  const reasonCode = boundedString(value.reasonCode, 'reasonCode', 100, {
    nullable: true
  });
  const unavailable = ['AGGREGATE_ONLY', 'NOT_CONNECTED', 'ERROR']
    .includes(sourceState);
  if (
    (unavailable && recordCoverage !== 'NONE')
    || (sourceState === 'PARTIAL' && recordCoverage !== 'PARTIAL')
    || (sourceState === 'AVAILABLE' && recordCoverage === 'NONE')
  ) fail('来源状态与记录覆盖率不一致');
  if ((sourceState !== 'AVAILABLE' || recordCoverage !== 'FULL') && !reasonCode) {
    fail('非完整来源必须提供 reasonCode');
  }
  return {
    sourceSystem,
    consultationType,
    sourceState,
    recordCoverage,
    reasonCode
  };
}

function normalizeLandingPage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('landingPage 字段无效');
  }
  const path = boundedString(value.path, 'landingPage.path', 500, {
    nullable: true
  });
  if (path && (!path.startsWith('/') || path.startsWith('//'))) {
    fail('landingPage.path 字段无效');
  }
  return {
    label: sanitizePublicText(value.label, 'landingPage.label', 100, {
      nullable: true
    }),
    path
  };
}

function normalizeExternalRecordUrl(value, allowedOrigins) {
  if (value === null || value === undefined || value === '') return null;
  const raw = boundedString(value, 'externalRecordUrl', 2000);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail('externalRecordUrl 字段无效');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || !allowedOrigins.includes(parsed.origin)
  ) fail('externalRecordUrl 字段无效');
  return parsed.toString();
}

function assertProjectBinding(value, expectedProjectId) {
  if (expectedProjectId === null || expectedProjectId === undefined) return;
  if (String(value?.projectId || '') !== String(expectedProjectId)) {
    fail('咨询记录项目归属无效');
  }
}

function normalizeSummary(value, expectedProjectId = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('咨询摘要无效');
  }
  assertProjectBinding(value, expectedProjectId);
  const sourceSystem = responseEnum(
    value.sourceSystem,
    SOURCE_SYSTEMS,
    'sourceSystem'
  );
  const consultationType = responseEnum(
    value.consultationType,
    CONSULTATION_TYPES,
    'consultationType'
  );
  if (
    (sourceSystem === 'GATO_WEBSITE' && consultationType !== 'WEBSITE_FORM')
    || (sourceSystem === 'KF53' && consultationType !== 'ONLINE_CHAT')
  ) fail('来源系统与咨询类型不一致');
  return {
    id: boundedString(value.id, 'id', 128),
    sourceSystem,
    consultationType,
    occurredAt: isoDateTime(value.occurredAt, 'occurredAt'),
    source: {
      key: boundedString(value.source?.key, 'source.key', 64),
      label: sanitizePublicText(value.source?.label, 'source.label', 80)
    },
    landingPage: normalizeLandingPage(value.landingPage),
    contentSummary: sanitizePublicText(
      value.contentSummary,
      'contentSummary',
      160
    ),
    maskedContact: maskedContact(value.maskedContact),
    device: responseEnum(value.device, DEVICES, 'device'),
    detailAvailable: value.detailAvailable === true
  };
}

function normalizeDetail(value, allowedOrigins = [], expectedProjectId = null) {
  const summary = normalizeSummary(
    { ...value, detailAvailable: true },
    expectedProjectId
  );
  const base = {
    ...summary,
    externalRecordUrl: normalizeExternalRecordUrl(
      value.externalRecordUrl,
      allowedOrigins
    )
  };
  if (summary.consultationType === 'WEBSITE_FORM') {
    if (!value.form || !Array.isArray(value.form.fields)) fail('表单详情无效');
    if (value.form.fields.length > MAX_FORM_FIELDS) fail('表单字段数量超限');
    const content = sanitizePublicText(value.form.content, 'form.content', 20000);
    const fields = value.form.fields.map((field) => ({
      label: sanitizePublicText(field?.label, 'form.fields.label', 80),
      value: sanitizePublicText(field?.value, 'form.fields.value', 4000)
    }));
    if (
      content.length + fields.reduce((total, field) => (
        total + field.label.length + field.value.length
      ), 0) > MAX_DETAIL_TEXT_CHARS
    ) fail('表单详情正文总量超限');
    return {
      ...base,
      consultationType: 'WEBSITE_FORM',
      form: {
        content,
        fields
      }
    };
  }
  if (!value.conversation || !Array.isArray(value.conversation.messages)) {
    fail('在线客服详情无效');
  }
  if (value.conversation.messages.length > MAX_CONVERSATION_MESSAGES) {
    fail('在线客服消息数量超限');
  }
  const messages = value.conversation.messages.map((message) => ({
    sender: responseEnum(
      message?.sender,
      ['VISITOR', 'AGENT'],
      'conversation.messages.sender'
    ),
    sentAt: isoDateTime(message?.sentAt, 'conversation.messages.sentAt'),
    content: sanitizePublicText(
      message?.content,
      'conversation.messages.content',
      10000
    )
  }));
  if (messages.reduce((total, message) => (
    total + message.content.length
  ), 0) > MAX_DETAIL_TEXT_CHARS) fail('在线客服正文总量超限');
  if (!messages.some((message) => message.sender === 'VISITOR')) {
    fail('在线客服对话缺少访客有效消息');
  }
  return {
    ...base,
    consultationType: 'ONLINE_CHAT',
    conversation: { messages }
  };
}

function coverageState(sources) {
  const available = sources.filter((source) => (
    source.recordCoverage !== 'NONE'
  )).length;
  if (available === 0) return 'NONE';
  if (available === sources.length
    && sources.every((source) => source.recordCoverage === 'FULL')) {
    return 'COMPLETE';
  }
  return 'PARTIAL';
}

module.exports = {
  CONSULTATION_TYPES,
  ConsultationRecordError,
  DEVICES,
  SCHEMA_VERSION,
  TIME_ZONE,
  coverageState,
  normalizeDetail,
  normalizeListQuery,
  normalizeSourceStatus,
  normalizeSummary,
  sanitizePublicText
};
