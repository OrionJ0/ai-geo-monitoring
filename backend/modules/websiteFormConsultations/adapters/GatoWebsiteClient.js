class GatoWebsiteError extends Error {
  constructor(message, code, status = 502, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const MAX_RESPONSE_BYTES = 512 * 1024;

async function readBoundedBody(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) {
    throw new GatoWebsiteError(
      '官网接口响应超过大小预算',
      'GATO_WEBSITE_RESPONSE_TOO_LARGE'
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new GatoWebsiteError(
        '官网接口响应超过大小预算',
        'GATO_WEBSITE_RESPONSE_TOO_LARGE'
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

async function defaultTransport({
  method,
  url,
  headers,
  json,
  timeoutMs,
  fetchImpl
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...headers
      },
      body: method === 'GET' ? undefined : JSON.stringify(json),
      redirect: 'error',
      signal: controller.signal
    });
  } catch (error) {
    throw new GatoWebsiteError(
      error?.name === 'AbortError'
        ? '官网接口请求超时'
        : '官网接口网络请求失败',
      error?.name === 'AbortError'
        ? 'GATO_WEBSITE_FORM_TIMEOUT'
        : 'GATO_WEBSITE_FORM_UPSTREAM_UNAVAILABLE',
      error?.name === 'AbortError' ? 504 : 502,
      error?.name !== 'AbortError'
    );
  } finally {
    clearTimeout(timeout);
  }
  const source = await readBoundedBody(response);
  let body;
  try {
    body = source ? JSON.parse(source) : {};
  } catch {
    throw new GatoWebsiteError(
      '官网接口返回非 JSON 响应',
      'GATO_WEBSITE_RESPONSE_INVALID'
    );
  }
  return { status: response.status, body };
}

function exactCount(value) {
  const normalized = typeof value === 'number' ? String(value) : value;
  if (typeof normalized !== 'string' || !/^\d+$/u.test(normalized)) {
    throw new GatoWebsiteError(
      '官网表单聚合响应无效',
      'GATO_WEBSITE_FORM_RESPONSE_INVALID'
    );
  }
  const count = BigInt(normalized);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GatoWebsiteError(
      '官网表单聚合响应超出安全范围',
      'GATO_WEBSITE_FORM_RESPONSE_INVALID'
    );
  }
  return count.toString();
}

function responseData(response) {
  if (
    !response
    || typeof response !== 'object'
    || !response.data
    || typeof response.data !== 'object'
  ) {
    throw new GatoWebsiteError(
      '官网接口响应无效',
      'GATO_WEBSITE_RESPONSE_INVALID'
    );
  }
  return response.data;
}

function normalizeFormConsultations(response) {
  const conversion = responseData(response).conversion;
  if (
    !conversion
    || typeof conversion !== 'object'
    || !conversion.summary
    || typeof conversion.summary !== 'object'
    || !Array.isArray(conversion.source_channels)
  ) {
    throw new GatoWebsiteError(
      '官网表单聚合响应无效',
      'GATO_WEBSITE_FORM_RESPONSE_INVALID'
    );
  }
  const seen = new Set();
  const sourceBreakdown = conversion.source_channels.map((row) => {
    const upstreamSource = String(row?.source || '').trim();
    if (
      !/^[a-z][a-z0-9_]{0,63}$/u.test(upstreamSource)
      || seen.has(upstreamSource)
    ) {
      throw new GatoWebsiteError(
        '官网表单来源响应无效',
        'GATO_WEBSITE_FORM_RESPONSE_INVALID'
      );
    }
    seen.add(upstreamSource);
    return {
      upstreamSource,
      attributedFormSubmissionSessions: exactCount(row?.submissions)
    };
  });
  return {
    attributedFormSubmissionSessions: exactCount(
      conversion.summary.submission_sessions
    ),
    sourceBreakdown
  };
}

function exactSafeInteger(value, field) {
  const normalized = typeof value === 'number' ? String(value) : value;
  if (typeof normalized !== 'string' || !/^\d+$/u.test(normalized)) {
    throw new GatoWebsiteError(
      `官网联系人${field}响应无效`,
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new GatoWebsiteError(
      `官网联系人${field}响应无效`,
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  return parsed;
}

function boundedContactText(value, field, maximum, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new GatoWebsiteError(
      `官网联系人${field}响应无效`,
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new GatoWebsiteError(
      `官网联系人${field}响应无效`,
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  return normalized;
}

function normalizeContactRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatoWebsiteError(
      '官网联系人记录响应无效',
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  const id = boundedContactText(String(value.id ?? ''), 'ID', 64);
  if (!/^[1-9]\d*$/u.test(id)) {
    throw new GatoWebsiteError(
      '官网联系人 ID 响应无效',
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  const createdAt = boundedContactText(value.createdAt, '创建时间', 40);
  const parsedCreatedAt = new Date(createdAt);
  if (
    Number.isNaN(parsedCreatedAt.getTime())
    || parsedCreatedAt.toISOString() !== createdAt
  ) {
    throw new GatoWebsiteError(
      '官网联系人创建时间响应无效',
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  const status = boundedContactText(value.status, '状态', 20);
  if (!['pending', 'processing', 'done'].includes(status)) {
    throw new GatoWebsiteError(
      '官网联系人状态响应无效',
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  return {
    id,
    name: boundedContactText(value.name, '姓名', 100),
    phone: boundedContactText(value.phone, '电话', 64),
    email: boundedContactText(value.email, '邮箱', 320, { nullable: true }),
    demandType: boundedContactText(value.demandType, '需求类型', 100),
    company: boundedContactText(value.company, '企业', 200, { nullable: true }),
    region: boundedContactText(value.region, '区域', 100, { nullable: true }),
    detail: boundedContactText(value.detail, '详情', 20000, { nullable: true }),
    status,
    createdAt
  };
}

function normalizeContactPage(response, expectedPage, expectedPageSize) {
  const data = responseData(response);
  if (!Array.isArray(data.list)) {
    throw new GatoWebsiteError(
      '官网联系人分页响应无效',
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  const page = exactSafeInteger(data.page, '页码');
  const pageSize = exactSafeInteger(data.pageSize, '页容量');
  const total = exactSafeInteger(data.total, '总数');
  if (
    page !== expectedPage
    || pageSize !== expectedPageSize
    || data.list.length > pageSize
    || total < data.list.length
  ) {
    throw new GatoWebsiteError(
      '官网联系人分页响应无效',
      'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
    );
  }
  return {
    list: data.list.map(normalizeContactRecord),
    page,
    pageSize,
    total
  };
}

function validContactRange(from, to) {
  const valid = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      return false;
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === value;
  };
  if (!valid(from) || !valid(to) || from > to) {
    throw new GatoWebsiteError(
      '官网联系人日期范围无效',
      'GATO_WEBSITE_CONTACT_DATE_RANGE_INVALID',
      422
    );
  }
  const days = (
    Date.parse(`${to}T00:00:00.000Z`)
    - Date.parse(`${from}T00:00:00.000Z`)
  ) / 86400000 + 1;
  if (days > 180) {
    throw new GatoWebsiteError(
      '官网联系人日期范围超过 180 天',
      'GATO_WEBSITE_CONTACT_DATE_RANGE_TOO_LARGE',
      422
    );
  }
}

function boundedDailyDates(from, to) {
  const valid = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      return false;
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === value;
  };
  if (!valid(from) || !valid(to) || from > to) {
    throw new GatoWebsiteError(
      '官网表单逐日范围无效',
      'GATO_WEBSITE_FORM_DATE_RANGE_INVALID',
      422
    );
  }
  const days = (
    Date.parse(`${to}T00:00:00.000Z`)
    - Date.parse(`${from}T00:00:00.000Z`)
  ) / 86400000 + 1;
  if (days > 31) {
    throw new GatoWebsiteError(
      '官网表单逐日范围超过 31 天',
      'GATO_WEBSITE_FORM_DAILY_RANGE_TOO_LARGE',
      422
    );
  }
  return Array.from({ length: days }, (_value, index) => {
    const date = new Date(`${from}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

class GatoWebsiteClient {
  constructor({
    baseUrl,
    username,
    password,
    timeoutMs,
    transport = null,
    fetchImpl = globalThis.fetch
  }) {
    let origin;
    try {
      const parsed = new URL(baseUrl);
      if (
        parsed.origin !== 'https://gato.com.cn'
        || parsed.protocol !== 'https:'
        || parsed.pathname !== '/'
        || parsed.search
        || parsed.hash
        || parsed.username
        || parsed.password
      ) throw new Error('invalid');
      origin = parsed.origin;
    } catch {
      throw new GatoWebsiteError(
        '官网表单客户端配置无效',
        'GATO_WEBSITE_FORM_CLIENT_CONFIG_INVALID',
        500
      );
    }
    if (
      !String(username || '').trim()
      || !String(password || '')
      || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 100
      || timeoutMs > 60000
      || (transport === null && typeof fetchImpl !== 'function')
      || (transport !== null && typeof transport !== 'function')
    ) {
      throw new GatoWebsiteError(
        '官网表单客户端配置无效',
        'GATO_WEBSITE_FORM_CLIENT_CONFIG_INVALID',
        500
      );
    }
    this.origin = origin;
    this.username = String(username).trim();
    this.password = String(password);
    this.timeoutMs = timeoutMs;
    this.transport = transport || ((request) => defaultTransport({
      ...request,
      fetchImpl
    }));
    this.token = null;
  }

  async login() {
    const result = await this.transport({
      method: 'POST',
      url: `${this.origin}/api/v1/auth/login`,
      headers: { 'Content-Type': 'application/json' },
      json: { username: this.username, password: this.password },
      timeoutMs: this.timeoutMs
    });
    const token = [200, 201].includes(result?.status)
      ? responseData(result.body).token
      : null;
    if (typeof token !== 'string' || !token || token.length > 8192) {
      throw new GatoWebsiteError(
        '官网只读认证失败',
        'GATO_WEBSITE_FORM_AUTH_FAILED',
        502
      );
    }
    this.token = token;
    return token;
  }

  async requestDashboard({ from, to, retryAuthorization = true }) {
    const token = this.token || await this.login();
    const url = new URL('/api/v1/admin/stats/dashboard', this.origin);
    url.searchParams.set('start_date', from);
    url.searchParams.set('end_date', to);
    const result = await this.transport({
      method: 'GET',
      url: url.toString(),
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: this.timeoutMs
    });
    if (result?.status === 401 && retryAuthorization) {
      this.token = null;
      await this.login();
      return this.requestDashboard({
        from,
        to,
        retryAuthorization: false
      });
    }
    if (result?.status !== 200) {
      throw new GatoWebsiteError(
        '官网表单聚合接口暂时不可用',
        'GATO_WEBSITE_FORM_UPSTREAM_FAILED',
        502,
        result?.status === 429 || result?.status >= 500
      );
    }
    return result.body;
  }

  async requestContactPath(url, retryAuthorization = true) {
    const token = this.token || await this.login();
    const result = await this.transport({
      method: 'GET',
      url: url.toString(),
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: this.timeoutMs
    });
    if (result?.status === 401 && retryAuthorization) {
      this.token = null;
      await this.login();
      return this.requestContactPath(url, false);
    }
    if (result?.status === 404) return null;
    if (result?.status !== 200) {
      throw new GatoWebsiteError(
        '官网联系人接口暂时不可用',
        'GATO_WEBSITE_CONTACT_UPSTREAM_FAILED',
        502,
        result?.status === 429 || result?.status >= 500
      );
    }
    return result.body;
  }

  async readContactRecords({ from, to, maxRecords }) {
    validContactRange(from, to);
    if (
      !Number.isSafeInteger(maxRecords)
      || maxRecords < 1
      || maxRecords > 10001
    ) {
      throw new GatoWebsiteError(
        '官网联系人读取预算无效',
        'GATO_WEBSITE_CONTACT_LIMIT_INVALID',
        500
      );
    }
    const pageSize = Math.min(100, maxRecords);
    const records = [];
    let page = 1;
    let expectedTotal = null;
    while (true) {
      const normalized = await this.readContactRecordPage({
        from,
        to,
        page,
        pageSize
      });
      if (expectedTotal === null) expectedTotal = normalized.total;
      if (normalized.total !== expectedTotal || expectedTotal > maxRecords) {
        throw new GatoWebsiteError(
          expectedTotal > maxRecords
            ? '官网联系人记录超过读取预算'
            : '官网联系人分页总数发生变化',
          expectedTotal > maxRecords
            ? 'GATO_WEBSITE_CONTACT_LIMIT_EXCEEDED'
            : 'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
        );
      }
      records.push(...normalized.records);
      if (records.length > maxRecords) {
        throw new GatoWebsiteError(
          '官网联系人记录超过读取预算',
          'GATO_WEBSITE_CONTACT_LIMIT_EXCEEDED'
        );
      }
      if (records.length >= expectedTotal) break;
      if (normalized.records.length === 0) {
        throw new GatoWebsiteError(
          '官网联系人分页提前结束',
          'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
        );
      }
      page += 1;
    }
    if (records.length !== expectedTotal) {
      throw new GatoWebsiteError(
        '官网联系人分页数量不一致',
        'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
      );
    }
    return records;
  }

  async readContactRecordPage({ from, to, page, pageSize }) {
    validContactRange(from, to);
    if (
      !Number.isSafeInteger(page)
      || page < 1
      || page > 10000
      || !Number.isSafeInteger(pageSize)
      || pageSize < 1
      || pageSize > 100
    ) {
      throw new GatoWebsiteError(
        '官网联系人分页参数无效',
        'GATO_WEBSITE_CONTACT_LIMIT_INVALID',
        500
      );
    }
    const url = new URL('/api/v1/admin/contact/list', this.origin);
    url.searchParams.set('startDate', from);
    url.searchParams.set('endDate', to);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    const response = await this.requestContactPath(url);
    if (response === null) {
      throw new GatoWebsiteError(
        '官网联系人列表接口不存在',
        'GATO_WEBSITE_CONTACT_UPSTREAM_FAILED'
      );
    }
    const normalized = normalizeContactPage(response, page, pageSize);
    return { total: normalized.total, records: normalized.list };
  }

  async readContactRecord(recordId) {
    const normalizedId = String(recordId || '');
    if (!/^[1-9]\d{0,63}$/u.test(normalizedId)) {
      throw new GatoWebsiteError(
        '官网联系人 ID 无效',
        'GATO_WEBSITE_CONTACT_ID_INVALID',
        422
      );
    }
    const url = new URL(
      `/api/v1/admin/contact/${encodeURIComponent(normalizedId)}`,
      this.origin
    );
    const response = await this.requestContactPath(url);
    return response === null ? null : normalizeContactRecord(responseData(response));
  }

  async readFormConsultations({ from, to }) {
    return normalizeFormConsultations(await this.requestDashboard({ from, to }));
  }

  async readFormConsultationDays({ from, to }) {
    const dates = boundedDailyDates(from, to);
    if (!this.token) await this.login();
    const days = [];
    for (let offset = 0; offset < dates.length; offset += 4) {
      const batch = dates.slice(offset, offset + 4);
      days.push(...await Promise.all(batch.map(async (date) => ({
        date,
        ...await this.readFormConsultations({ from: date, to: date })
      }))));
    }
    const sources = new Map();
    let total = 0n;
    for (const day of days) {
      total += BigInt(day.attributedFormSubmissionSessions);
      for (const row of day.sourceBreakdown) {
        sources.set(
          row.upstreamSource,
          (sources.get(row.upstreamSource) || 0n)
            + BigInt(row.attributedFormSubmissionSessions)
        );
      }
    }
    return {
      attributedFormSubmissionSessions: total.toString(),
      sourceBreakdown: [...sources].map(([upstreamSource, count]) => ({
        upstreamSource,
        attributedFormSubmissionSessions: count.toString()
      })),
      days
    };
  }
}

module.exports = {
  GatoWebsiteClient,
  GatoWebsiteError,
  normalizeContactRecord,
  normalizeFormConsultations
};
