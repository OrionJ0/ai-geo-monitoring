const { Setting } = require('../models');

const OWNED_ORIGINS_SETTING_KEY = 'seo_audit_owned_origins';
const MAX_OWNED_ORIGINS = 10;
const MAX_SETTING_VALUE_LENGTH = 255;

class SeoAuditSettingsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SeoAuditSettingsError';
    this.code = code;
    this.status = 400;
  }
}

function normalizeOwnedOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new SeoAuditSettingsError(
      '自有站点不能为空',
      'INVALID_SEO_AUDIT_OWNED_ORIGIN'
    );
  }

  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new SeoAuditSettingsError(
      `无法识别站点 Origin：${raw}`,
      'INVALID_SEO_AUDIT_OWNED_ORIGIN'
    );
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.hostname.includes('*')
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new SeoAuditSettingsError(
      '请输入完整站点 Origin（如 https://example.com），不能包含路径、通配符、账号、查询或锚点',
      'INVALID_SEO_AUDIT_OWNED_ORIGIN'
    );
  }
  return parsed.origin;
}

function normalizeOwnedOrigins(values) {
  if (!Array.isArray(values)) {
    throw new SeoAuditSettingsError(
      'ownedOrigins 必须是数组',
      'INVALID_SEO_AUDIT_OWNED_ORIGINS'
    );
  }
  if (values.length > MAX_OWNED_ORIGINS) {
    throw new SeoAuditSettingsError(
      `自有站点最多配置 ${MAX_OWNED_ORIGINS} 个`,
      'TOO_MANY_SEO_AUDIT_OWNED_ORIGINS'
    );
  }

  const normalized = Array.from(new Set(values.map(normalizeOwnedOrigin)));
  const serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_SETTING_VALUE_LENGTH) {
    throw new SeoAuditSettingsError(
      '自有站点配置总长度过长，请减少站点数量或域名长度',
      'SEO_AUDIT_OWNED_ORIGINS_TOO_LONG'
    );
  }
  return normalized;
}

class SeoAuditSettingsService {
  constructor({ model = Setting } = {}) {
    this.model = model;
  }

  async getSettings() {
    const row = await this.model.findOne({
      where: { key: OWNED_ORIGINS_SETTING_KEY }
    });
    if (!row) return { ownedOrigins: [] };

    try {
      const parsed = JSON.parse(row.value);
      return { ownedOrigins: normalizeOwnedOrigins(parsed) };
    } catch {
      return { ownedOrigins: [] };
    }
  }

  async setOwnedOrigins(values) {
    const ownedOrigins = normalizeOwnedOrigins(values);
    const value = JSON.stringify(ownedOrigins);
    const existing = await this.model.findOne({
      where: { key: OWNED_ORIGINS_SETTING_KEY }
    });
    if (existing) await existing.update({ value });
    else await this.model.create({ key: OWNED_ORIGINS_SETTING_KEY, value });
    return { ownedOrigins };
  }

  async isOwnedOrigin(inputUrl) {
    let origin;
    try {
      origin = new URL(inputUrl).origin;
    } catch {
      return false;
    }
    const { ownedOrigins } = await this.getSettings();
    return ownedOrigins.includes(origin);
  }
}

const service = new SeoAuditSettingsService();

module.exports = service;
module.exports.SeoAuditSettingsService = SeoAuditSettingsService;
module.exports.SeoAuditSettingsError = SeoAuditSettingsError;
module.exports.OWNED_ORIGINS_SETTING_KEY = OWNED_ORIGINS_SETTING_KEY;
module.exports.normalizeOwnedOrigin = normalizeOwnedOrigin;
module.exports.normalizeOwnedOrigins = normalizeOwnedOrigins;
