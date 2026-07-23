const AIPlatformConfigService = require('./AIPlatformConfigService');
const AIPlatformRequestService = require('./AIPlatformRequestService');
const { getUnavailableReason } = require('./AIPlatformConfigService');

function normalizeCodes(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .map((code) => String(code || '').trim().toLowerCase())
      .filter(Boolean)
  ));
}

class AIPlatformService {
  constructor(options = {}) {
    this.requestService = options.requestService || AIPlatformRequestService;
    this.configService = options.configService || AIPlatformConfigService;
  }

  async queryPlatform(platform, question, options = {}) {
    return this.requestService.queryPlatform(platform, question, options);
  }

  async queryMultiplePlatforms(platforms, question, options = {}) {
    return Promise.all(normalizeCodes(platforms).map((platform) => (
      this.queryPlatform(platform, question, options)
    )));
  }

  async getAvailablePlatforms() {
    const catalog = await this.configService.listCatalog();
    return catalog.filter((platform) => platform.selectable).map((platform) => platform.code);
  }

  async getPlatformCodes() {
    const catalog = await this.configService.listCatalog();
    return catalog.map((platform) => platform.code);
  }

  async getPlatformAvailability(codes) {
    const requestedCodes = normalizeCodes(codes);
    const rows = await this.configService.listPlatformRows(requestedCodes, { includeArchived: true });
    const rowsByCode = new Map(rows.map((row) => [row.code, row]));

    return requestedCodes.map((code) => {
      const row = rowsByCode.get(code);
      const reason = row ? getUnavailableReason(row) : 'config_unavailable';
      return {
        code,
        platform_name: row?.name || code,
        model_name: row?.default_model || null,
        available: reason === null,
        reason,
        config: row || null
      };
    });
  }
}

const service = new AIPlatformService();

module.exports = service;
module.exports.AIPlatformService = AIPlatformService;
module.exports.normalizeCodes = normalizeCodes;
