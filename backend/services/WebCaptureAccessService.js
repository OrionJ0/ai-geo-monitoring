const { QuestionRecord } = require('../models');
const WebPlatformService = require('./WebPlatformService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class WebCaptureAccessError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'WebCaptureAccessError';
    this.code = code;
    this.status = status;
  }
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function artifactsFrom(record) {
  const artifacts = record?.result_summary?.web_capture?.artifacts;
  return artifacts && typeof artifacts === 'object' ? Object.values(artifacts) : [];
}

function referencesArtifact(record, artifactId) {
  return artifactsFrom(record).some(
    (artifact) => String(artifact?.id || '').toLowerCase() === artifactId
  );
}

class WebCaptureAccessService {
  constructor(options = {}) {
    this.questionRecordModel = options.questionRecordModel || QuestionRecord;
    this.captureStore = options.captureStore || WebPlatformService.getCaptureStore();
  }

  async openForUser({ recordId, artifactId, user }) {
    const normalizedRecordId = positiveInteger(recordId);
    const normalizedArtifactId = String(artifactId || '').toLowerCase();
    if (!normalizedRecordId || !UUID_RE.test(normalizedArtifactId)) {
      throw new WebCaptureAccessError(
        'invalid_web_capture_reference',
        'Web 证据引用无效',
        400
      );
    }
    const record = await this.questionRecordModel.findByPk(normalizedRecordId);
    if (!record) {
      throw new WebCaptureAccessError('web_capture_not_found', 'Web 证据不存在', 404);
    }
    const isAdmin = user?.role === 'admin';
    if (!isAdmin && Number(record.user_id) !== Number(user?.id)) {
      throw new WebCaptureAccessError('web_capture_forbidden', '无权访问 Web 证据', 403);
    }
    const referenced = referencesArtifact(record, normalizedArtifactId);
    if (!referenced) {
      throw new WebCaptureAccessError('web_capture_not_found', 'Web 证据不存在', 404);
    }
    const ownerRecordId = positiveInteger(
      record?.result_summary?.web_capture?.artifact_owner_record_id
    );
    if (!ownerRecordId) {
      throw new WebCaptureAccessError(
        'invalid_web_capture_reference',
        'Web 证据归属无效',
        400
      );
    }
    if (ownerRecordId !== normalizedRecordId) {
      const ownerRecord = await this.questionRecordModel.findByPk(ownerRecordId);
      if (!ownerRecord) {
        throw new WebCaptureAccessError('web_capture_not_found', 'Web 证据不存在', 404);
      }
      if (!isAdmin && Number(ownerRecord.user_id) !== Number(user?.id)) {
        throw new WebCaptureAccessError('web_capture_forbidden', '无权访问 Web 证据', 403);
      }
      if (!referencesArtifact(ownerRecord, normalizedArtifactId)) {
        throw new WebCaptureAccessError('web_capture_not_found', 'Web 证据不存在', 404);
      }
    }
    try {
      return await this.captureStore.openArtifact(ownerRecordId, normalizedArtifactId);
    } catch (error) {
      if (error.code === 'web_capture_missing') {
        throw new WebCaptureAccessError('web_capture_missing', 'Web 证据文件已丢失', 410);
      }
      if (error.code === 'invalid_web_capture_reference') {
        throw new WebCaptureAccessError(
          'invalid_web_capture_reference',
          'Web 证据引用无效',
          400
        );
      }
      throw error;
    }
  }
}

const service = new WebCaptureAccessService();

module.exports = service;
module.exports.WebCaptureAccessService = WebCaptureAccessService;
module.exports.WebCaptureAccessError = WebCaptureAccessError;
