const { randomUUID } = require('node:crypto');
const { sequelize } = require('../models');
const WebPlatformService = require('./WebPlatformService');

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
    this.captureStore = options.captureStore || WebPlatformService.getCaptureStore();
    this.transactionRunner = options.transactionRunner
      || ((work) => sequelize.transaction(work));
    this.operationIdFactory = options.operationIdFactory || randomUUID;
  }

  normalizeRecordIds(recordIds) {
    return Array.from(new Set(
      (Array.isArray(recordIds) ? recordIds : [])
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    )).sort((a, b) => a - b);
  }

  async deleteRecords(recordIds, databaseWork) {
    const ids = this.normalizeRecordIds(recordIds);
    const operationId = this.operationIdFactory();
    await this.captureStore.quarantineRecords(ids, operationId);
    let result;
    try {
      result = await this.transactionRunner((transaction) => databaseWork(transaction));
    } catch (error) {
      try {
        await this.captureStore.restoreQuarantine(operationId);
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
      await this.captureStore.commitQuarantine(operationId);
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
