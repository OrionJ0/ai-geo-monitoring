const {
  ConsultationRecordError
} = require('../contracts/consultationRecordContract');

function configuredSourceClient(value) {
  return value
    && typeof value.readContactRecords === 'function'
    && typeof value.readContactRecord === 'function';
}

function assertProject(projectId, configuredProjectId) {
  if (String(projectId) !== configuredProjectId) {
    throw new ConsultationRecordError(
      '项目不存在',
      'WEBSITE_FORM_PROJECT_MISMATCH',
      404
    );
  }
}

function content(record) {
  return record.detail || record.demandType;
}

function summary(record, projectId) {
  return {
    projectId,
    id: `website:${record.id}`,
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    occurredAt: record.createdAt,
    source: {
      key: 'UNATTRIBUTED',
      label: '官网表单（来源未提供）'
    },
    landingPage: { label: null, path: null },
    contentSummary: content(record).slice(0, 160),
    maskedContact: {
      displayName: record.name,
      phone: record.phone,
      email: record.email
    },
    device: 'UNKNOWN',
    detailAvailable: true
  };
}

class WebsiteFormRecordAdapter {
  constructor({ sourceClient = null, configuredProjectId = null } = {}) {
    this.sourceSystem = 'GATO_WEBSITE';
    this.consultationType = 'WEBSITE_FORM';
    this.allowedExternalOrigins = ['https://gato.com.cn'];
    this.sourceClient = configuredSourceClient(sourceClient)
      ? sourceClient
      : null;
    this.configuredProjectId = configuredProjectId === null
      || configuredProjectId === undefined
      ? null
      : String(configuredProjectId);
  }

  async getStatus({ projectId = null } = {}) {
    if (
      projectId !== null
      && this.configuredProjectId
      && String(projectId) !== this.configuredProjectId
    ) {
      return {
        sourceSystem: this.sourceSystem,
        consultationType: this.consultationType,
        sourceState: 'NOT_CONNECTED',
        recordCoverage: 'NONE',
        reasonCode: 'WEBSITE_FORM_PROJECT_NOT_CONFIGURED'
      };
    }
    if (this.sourceClient && this.configuredProjectId) {
      return {
        sourceSystem: this.sourceSystem,
        consultationType: this.consultationType,
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    }
    return {
      sourceSystem: this.sourceSystem,
      consultationType: this.consultationType,
      sourceState: 'AGGREGATE_ONLY',
      recordCoverage: 'NONE',
      reasonCode: 'WEBSITE_FORM_RECORD_API_UNVERIFIED'
    };
  }

  owns(recordId) {
    return String(recordId).startsWith('website:');
  }

  async listRecords({ projectId, query, limit }) {
    if (!this.sourceClient || !this.configuredProjectId) return [];
    assertProject(projectId, this.configuredProjectId);
    const records = await this.sourceClient.readContactRecords({
      from: query.from,
      to: query.to,
      maxRecords: limit
    });
    return records.map((record) => summary(record, this.configuredProjectId));
  }

  async listRecordPage({ projectId, query, page, pageSize }) {
    if (
      !this.sourceClient
      || !this.configuredProjectId
      || typeof this.sourceClient.readContactRecordPage !== 'function'
    ) return null;
    assertProject(projectId, this.configuredProjectId);
    const result = await this.sourceClient.readContactRecordPage({
      from: query.from,
      to: query.to,
      page,
      pageSize
    });
    if (
      !result
      || !Array.isArray(result.records)
      || !Number.isSafeInteger(result.total)
      || result.total < 0
      || result.records.length > pageSize
    ) {
      throw new ConsultationRecordError(
        '官网联系人分页响应无效',
        'CONSULTATION_RECORD_RESPONSE_INVALID',
        502
      );
    }
    return {
      totalItems: result.total,
      items: result.records.map((record) => (
        summary(record, this.configuredProjectId)
      ))
    };
  }

  async getRecord({ projectId, recordId }) {
    if (!this.sourceClient || !this.configuredProjectId) return null;
    assertProject(projectId, this.configuredProjectId);
    const upstreamId = String(recordId).slice('website:'.length);
    if (!/^[1-9]\d{0,63}$/u.test(upstreamId)) return null;
    const record = await this.sourceClient.readContactRecord(upstreamId);
    if (!record) return null;
    const base = summary(record, this.configuredProjectId);
    const fields = [
      ['需求类型', record.demandType],
      ['企业', record.company],
      ['区域', record.region]
    ].filter(([, value]) => value);
    return {
      ...base,
      externalRecordUrl: null,
      form: {
        content: content(record),
        fields: fields.map(([label, value]) => ({ label, value }))
      }
    };
  }
}

module.exports = { WebsiteFormRecordAdapter };
