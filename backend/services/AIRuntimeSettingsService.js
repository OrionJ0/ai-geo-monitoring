const { Setting } = require('../models');

const AI_RUNTIME_SETTING_DEFINITIONS = Object.freeze({
  ai_run_concurrency: Object.freeze({ min: 1, max: 5, defaultValue: 2 }),
  ai_retry_count: Object.freeze({ min: 0, max: 3, defaultValue: 3 }),
  ai_default_timeout_seconds: Object.freeze({ min: 10, max: 180, defaultValue: 90 }),
  ai_default_max_tokens: Object.freeze({ min: 256, max: 32768, defaultValue: 4096 })
});

const DEFAULT_AI_RUNTIME_SETTINGS = Object.freeze(
  Object.fromEntries(
    Object.entries(AI_RUNTIME_SETTING_DEFINITIONS).map(([key, definition]) => [key, definition.defaultValue])
  )
);

class AIRuntimeSettingsService {
  constructor(options = {}) {
    this.model = options.model || Setting;
  }

  isValid(key, value) {
    const definition = AI_RUNTIME_SETTING_DEFINITIONS[key];
    const number = Number(value);
    return Boolean(definition)
      && Number.isInteger(number)
      && number >= definition.min
      && number <= definition.max;
  }

  async ensureDefaults() {
    for (const [key, value] of Object.entries(DEFAULT_AI_RUNTIME_SETTINGS)) {
      await this.model.findOrCreate({
        where: { key },
        defaults: { key, value: String(value) }
      });
    }
  }

  async getSettings() {
    const rows = await this.model.findAll({ where: { key: Object.keys(AI_RUNTIME_SETTING_DEFINITIONS) } });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    return Object.fromEntries(
      Object.entries(AI_RUNTIME_SETTING_DEFINITIONS).map(([key, definition]) => {
        const value = stored.get(key);
        return [key, this.isValid(key, value) ? Number(value) : definition.defaultValue];
      })
    );
  }
}

const service = new AIRuntimeSettingsService();

module.exports = service;
module.exports.AIRuntimeSettingsService = AIRuntimeSettingsService;
module.exports.AI_RUNTIME_SETTING_DEFINITIONS = AI_RUNTIME_SETTING_DEFINITIONS;
module.exports.DEFAULT_AI_RUNTIME_SETTINGS = DEFAULT_AI_RUNTIME_SETTINGS;
