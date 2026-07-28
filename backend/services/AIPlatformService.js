const AIPlatformConfigService = require('./AIPlatformConfigService');
const AIPlatformRequestService = require('./AIPlatformRequestService');
const WebPlatformRegistry = require('./WebPlatformRegistry');
const {
  getUnavailableReason,
  hasPlatformCapability
} = require('./AIPlatformConfigService');

function normalizeCodes(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .map((code) => String(code || '').trim().toLowerCase())
      .filter(Boolean)
  ));
}

function webFailure(definition, code, message) {
  return {
    success: false,
    platform: definition.code,
    error_code: code,
    error: message,
    web_capture: {
      schema_version: definition.captureSchemaVersion,
      status: 'failed',
      failure: {
        stage: 'preflight',
        error_code: code
      }
    }
  };
}

class AIPlatformService {
  constructor(options = {}) {
    this.requestService = options.requestService || AIPlatformRequestService;
    this.configService = options.configService || AIPlatformConfigService;
    this.webPlatformRegistry = options.webPlatformRegistry || WebPlatformRegistry;
  }

  async queryPlatform(platform, question, options = {}) {
    const code = String(platform || '').trim().toLowerCase();
    const adapterType = String(options.config?.adapter_type || '');
    const definitions = this.webPlatformRegistry.listDefinitions();
    const definitionByCode = definitions.find((item) => item.code === code);
    const definitionByAdapter = definitions.find(
      (item) => item.adapterType === adapterType
    );
    if (definitionByCode || definitionByAdapter) {
      const definition = definitionByCode || definitionByAdapter;
      try {
        this.webPlatformRegistry.validateManagedConfig({
          code,
          adapter_type: options.config?.adapter_type
        });
      } catch {
        return webFailure(
          definition,
          'managed_config_invalid',
          `${definition.displayName} 受管平台配置无效`
        );
      }
      if (options.purpose !== 'project_monitoring') {
        return webFailure(
          definition,
          'unsupported_platform_capability',
          `${definition.displayName} 仅支持项目监测入口`
        );
      }
      const recordId = Number(options.capture_owner?.record_id);
      const userId = Number(options.capture_owner?.user_id);
      if (
        !Number.isSafeInteger(recordId)
        || recordId <= 0
        || !Number.isSafeInteger(userId)
        || userId <= 0
      ) {
        return webFailure(
          definition,
          'web_capture_owner_missing',
          `${definition.displayName} 查询缺少记录归属`
        );
      }
      return this.webPlatformRegistry.getService(definition.code).queryPlatform(question, {
        capture_owner: {
          record_id: recordId,
          user_id: userId,
          project_id: options.capture_owner?.project_id,
          execution_token: options.capture_owner?.execution_token
        }
      });
    }
    return this.requestService.queryPlatform(platform, question, options);
  }

  async queryMultiplePlatforms(platforms, question, options = {}) {
    return Promise.all(normalizeCodes(platforms).map((platform) => (
      this.queryPlatform(platform, question, options)
    )));
  }

  async getAvailablePlatforms({ capability = 'monitoring' } = {}) {
    const catalog = await this.configService.listCatalog();
    return catalog
      .filter((platform) => platform.selectable && platform.capabilities?.[capability] === true)
      .map((platform) => platform.code);
  }

  async getPlatformCodes() {
    const catalog = await this.configService.listCatalog();
    return catalog.map((platform) => platform.code);
  }

  async getPlatformAvailability(codes, {
    capability = 'monitoring',
    runtimeProbe = true
  } = {}) {
    const requestedCodes = normalizeCodes(codes);
    const rows = await this.configService.listPlatformRows(requestedCodes, { includeArchived: true });
    const rowsByCode = new Map(rows.map((row) => [row.code, row]));

    return Promise.all(requestedCodes.map(async (code) => {
      const row = rowsByCode.get(code);
      let reason = row
        ? (
          hasPlatformCapability(row, capability)
            ? getUnavailableReason(row)
            : 'unsupported_platform_capability'
        )
        : 'config_unavailable';
      if (
        reason === null
        && runtimeProbe
        && this.webPlatformRegistry.hasDefinition(row.code)
      ) {
        try {
          this.webPlatformRegistry.validateManagedConfig(row);
          await this.webPlatformRegistry.getService(row.code).preflight();
        } catch (error) {
          reason = (
            String(error?.code || '').startsWith('web_')
            || error?.code === 'managed_config_invalid'
          )
            ? error.code
            : 'web_browser_launch_failed';
        }
      }
      return {
        code,
        platform_name: row?.name || code,
        model_name: row?.default_model || null,
        available: reason === null,
        reason,
        config: reason === null ? row : null
      };
    }));
  }
}

const service = new AIPlatformService();

module.exports = service;
module.exports.AIPlatformService = AIPlatformService;
module.exports.normalizeCodes = normalizeCodes;
