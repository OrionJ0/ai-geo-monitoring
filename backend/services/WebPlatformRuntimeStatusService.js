const { Op } = require('sequelize');
const {
  QuestionRecord,
  QuestionSetRun
} = require('../models');
const AIPlatformConfigService = require('./AIPlatformConfigService');
const WebPlatformRegistry = require('./WebPlatformRegistry');
const PUBLIC_UNAVAILABLE_CODES = new Set([
  'web_browser_not_configured',
  'web_browser_launch_failed',
  'web_profile_in_use',
  'web_runtime_config_invalid',
  'web_selector_mismatch',
  'web_browser_connection_failed',
  'web_browser_closed'
]);

function booleanValue(row, field) {
  if (typeof row?.get === 'function') return Boolean(row.get(field));
  return Boolean(row?.[field]);
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function publicBlocker(snapshot) {
  const code = String(snapshot?.blocking_error_code || '');
  if (code === 'web_login_required') {
    return {
      state: 'login_required',
      needs_action: true,
      action_code: 'contact_vm_operator',
      reason_code: code
    };
  }
  if (code === 'web_verification_required') {
    return {
      state: 'verification_required',
      needs_action: true,
      action_code: 'contact_vm_operator',
      reason_code: code
    };
  }
  if (PUBLIC_UNAVAILABLE_CODES.has(code) || snapshot?.lifecycle_state === 'selector_mismatch') {
    return {
      state: 'unavailable',
      needs_action: true,
      action_code: 'contact_vm_operator',
      reason_code: PUBLIC_UNAVAILABLE_CODES.has(code) ? code : 'web_selector_mismatch'
    };
  }
  if (code) {
    return {
      state: 'unavailable',
      needs_action: true,
      action_code: 'contact_vm_operator',
      reason_code: 'web_runtime_unavailable'
    };
  }
  return null;
}

class WebPlatformRuntimeStatusService {
  constructor({
    questionRecordModel = QuestionRecord,
    questionSetRunModel = QuestionSetRun,
    aiPlatformConfigService = AIPlatformConfigService,
    webPlatformRegistry = WebPlatformRegistry,
    now = () => new Date()
  } = {}) {
    this.questionRecordModel = questionRecordModel;
    this.questionSetRunModel = questionSetRunModel;
    this.aiPlatformConfigService = aiPlatformConfigService;
    this.webPlatformRegistry = webPlatformRegistry;
    this.now = now;
  }

  async countActionablePending(platformCode, observedAt) {
    return this.questionRecordModel.count({
      where: {
        platform: platformCode,
        status: 'pending',
        [Op.or]: [
          { question_set_run_id: null },
          {
            '$questionSetRun.id$': { [Op.ne]: null },
            '$questionSetRun.paused_at$': null
          },
          {
            execution_token: { [Op.ne]: null },
            lease_expires_at: { [Op.gt]: observedAt }
          }
        ]
      },
      include: [{
        model: this.questionSetRunModel,
        as: 'questionSetRun',
        required: false,
        attributes: []
      }]
    });
  }

  async getStatus(platformCode = 'deepseek-web') {
    const definition = this.webPlatformRegistry.getDefinition(platformCode);
    const observedAt = new Date(this.now());
    let platform;
    let configUnavailable = false;
    try {
      platform = await this.aiPlatformConfigService.getPlatformByCode(definition.code);
    } catch (error) {
      if (error?.code !== 'platform_not_found') throw error;
      configUnavailable = true;
    }
    const enabled = !configUnavailable && booleanValue(platform, 'enabled');
    const runtimeSnapshot = this.webPlatformRegistry
      .getService(definition.code)
      .getRuntimeSnapshot();
    const runningCount = Math.min(
      nonNegativeInteger(runtimeSnapshot?.running_count),
      1
    );
    const actionablePendingCount = enabled
      ? nonNegativeInteger(await this.countActionablePending(definition.code, observedAt))
      : 0;
    const pendingCount = Math.max(actionablePendingCount, runningCount);
    const queuedCount = Math.max(pendingCount - runningCount, 0);
    const blocker = publicBlocker(runtimeSnapshot);
    let publicState;
    if (runtimeSnapshot?.shutting_down) {
      publicState = {
        state: 'shutting_down',
        needs_action: false,
        action_code: null,
        reason_code: null
      };
    } else if (configUnavailable) {
      publicState = {
        state: 'unavailable',
        needs_action: true,
        action_code: 'contact_vm_operator',
        reason_code: 'config_unavailable'
      };
    } else if (!enabled) {
      publicState = {
        state: 'unavailable',
        needs_action: false,
        action_code: null,
        reason_code: 'disabled'
      };
    } else if (blocker) {
      publicState = blocker;
    } else {
      publicState = {
        state: pendingCount > 0 || runningCount > 0 ? 'busy' : 'idle',
        needs_action: false,
        action_code: null,
        reason_code: null
      };
    }

    return {
      schema_version: definition.runtimeSchemaVersion,
      platform: definition.code,
      enabled,
      state: publicState.state,
      running_count: runningCount,
      queued_count: queuedCount,
      pending_count: pendingCount,
      needs_action: publicState.needs_action,
      action_code: publicState.action_code,
      reason_code: publicState.reason_code,
      observed_at: observedAt.toISOString()
    };
  }
}

const service = new WebPlatformRuntimeStatusService();

module.exports = service;
module.exports.WebPlatformRuntimeStatusService = WebPlatformRuntimeStatusService;
