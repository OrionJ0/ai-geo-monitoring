const { randomUUID } = require('node:crypto');
const { sequelize, QuestionRecord } = require('../models');
const WebPlatformRegistry = require('./WebPlatformRegistry');

class WebCaptureCleanupError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'WebCaptureCleanupError';
    this.code = code;
    this.status = 500;
    this.databaseCommitted = options.databaseCommitted === true;
    if (options.cause) this.cause = options.cause;
  }
}

class WebCaptureDeletionService {
  constructor(options = {}) {
    this.legacyCaptureStore = options.captureStore || null;
    this.questionRecordModel = options.questionRecordModel || QuestionRecord;
    this.webPlatformRegistry = options.webPlatformRegistry || WebPlatformRegistry;
    this.transactionRunner = options.transactionRunner
      || ((work) => sequelize.transaction(work));
    this.operationIdFactory = options.operationIdFactory || randomUUID;
    Object.defineProperty(this, 'captureStore', {
      enumerable: true,
      get: () => this.legacyCaptureStore || this.webPlatformRegistry
        .getService('deepseek-web')
        .getCaptureStore()
    });
  }

  normalizeRecordIds(recordIds) {
    return Array.from(new Set(
      (Array.isArray(recordIds) ? recordIds : [])
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    )).sort((a, b) => a - b);
  }

  async resolveStoreGroups(ids) {
    if (this.legacyCaptureStore) {
      return [{
        platform: 'legacy-web',
        recordIds: ids,
        store: this.legacyCaptureStore
      }];
    }
    const rows = await this.questionRecordModel.findAll({
      where: { id: ids },
      attributes: ['id', 'platform'],
      raw: true
    });
    const groupedIds = new Map();
    for (const row of rows) {
      const platform = String(row?.platform || '').trim().toLowerCase();
      if (!this.webPlatformRegistry.hasDefinition(platform)) continue;
      if (!groupedIds.has(platform)) groupedIds.set(platform, []);
      groupedIds.get(platform).push(Number(row.id));
    }
    return Array.from(groupedIds.entries()).map(([platform, recordIds]) => ({
      platform,
      recordIds: recordIds.sort((a, b) => a - b),
      store: this.webPlatformRegistry.getService(platform).getCaptureStore()
    }));
  }

  async restoreGroups(groups, operationId) {
    let firstError = null;
    for (const group of [...groups].reverse()) {
      try {
        await group.store.restoreQuarantine(operationId);
      } catch (error) {
        firstError ||= Object.assign(error, { platform: group.platform });
      }
    }
    if (firstError) throw firstError;
  }

  async deleteRecords(recordIds, databaseWork) {
    const ids = this.normalizeRecordIds(recordIds);
    const operationId = this.operationIdFactory();
    const groups = await this.resolveStoreGroups(ids);
    const quarantined = [];
    try {
      for (const group of groups) {
        await group.store.quarantineRecords(group.recordIds, operationId);
        quarantined.push(group);
      }
    } catch (error) {
      try {
        await this.restoreGroups(quarantined, operationId);
      } catch (restoreError) {
        throw new WebCaptureCleanupError(
          'web_capture_restore_failed',
          'Web 证据隔离失败后的恢复未完成',
          { cause: restoreError }
        );
      }
      throw error;
    }
    let result;
    try {
      result = await this.transactionRunner((transaction) => databaseWork(transaction));
    } catch (error) {
      try {
        await this.restoreGroups(quarantined, operationId);
      } catch (restoreError) {
        throw new WebCaptureCleanupError(
          'web_capture_restore_failed',
          '数据库回滚后 Web 证据恢复失败',
          { cause: restoreError }
        );
      }
      throw error;
    }
    try {
      for (const group of quarantined) {
        try {
          await group.store.commitQuarantine(operationId);
        } catch (error) {
          error.platform = group.platform;
          throw error;
        }
      }
    } catch (error) {
      throw new WebCaptureCleanupError(
        'web_capture_cleanup_incomplete',
        '数据库已提交，但 Web 证据物理清理未完成',
        { cause: error, databaseCommitted: true }
      );
    }
    return result;
  }
}

const service = new WebCaptureDeletionService();

module.exports = service;
module.exports.WebCaptureDeletionService = WebCaptureDeletionService;
module.exports.WebCaptureCleanupError = WebCaptureCleanupError;
