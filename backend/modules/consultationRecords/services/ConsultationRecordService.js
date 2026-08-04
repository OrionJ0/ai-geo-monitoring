const {
  SCHEMA_VERSION,
  TIME_ZONE,
  ConsultationRecordError,
  coverageState,
  normalizeDetail,
  normalizeSourceStatus,
  normalizeSummary
} = require('../contracts/consultationRecordContract');

// 需要客户端筛选的非默认查询必须受控全扫；2000 条意味着官网上游
// 每次最多 21 个分页请求（含越界探测），超过预算时明确失败而非截断。
const MAX_ADAPTER_RECORDS = 2000;

function validAdapter(adapter) {
  return adapter
    && typeof adapter.getStatus === 'function'
    && typeof adapter.owns === 'function'
    && typeof adapter.listRecords === 'function'
    && typeof adapter.getRecord === 'function'
    && Array.isArray(adapter.allowedExternalOrigins);
}

function shanghaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function matchesQuery(record, query) {
  const date = shanghaiDate(record.occurredAt);
  if (date < query.from || date > query.to) return false;
  if (query.type !== 'ALL' && record.consultationType !== query.type) {
    return false;
  }
  if (query.source !== 'ALL' && record.source.key !== query.source) return false;
  if (query.device !== 'ALL' && record.device !== query.device) return false;
  if (!query.q) return true;
  const haystack = [
    record.contentSummary,
    record.source.label,
    record.landingPage.label,
    record.landingPage.path,
    record.maskedContact.displayName
  ].filter(Boolean).join('\n').toLocaleLowerCase('zh-CN');
  return haystack.includes(query.q.toLocaleLowerCase('zh-CN'));
}

function compareRecords(left, right, query) {
  let comparison = 0;
  if (query.sortBy === 'occurredAt') {
    comparison = left.occurredAt.localeCompare(right.occurredAt);
  } else if (query.sortBy === 'consultationType') {
    comparison = left.consultationType.localeCompare(right.consultationType);
  } else {
    comparison = left.source.label.localeCompare(right.source.label, 'zh-CN');
  }
  if (comparison === 0) comparison = left.id.localeCompare(right.id);
  return query.sortOrder === 'asc' ? comparison : -comparison;
}

function canUseDirectPage(adapter, query) {
  return typeof adapter.listRecordPage === 'function'
    && !query.q
    && query.source === 'ALL'
    && ['ALL', 'UNKNOWN'].includes(query.device)
    && query.sortBy === 'occurredAt'
    && query.sortOrder === 'desc';
}

class ConsultationRecordService {
  constructor({ adapters, auditRepository }) {
    if (
      !Array.isArray(adapters)
      || adapters.length !== 2
      || adapters.some((adapter) => !validAdapter(adapter))
      || !auditRepository
      || typeof auditRepository.recordView !== 'function'
    ) {
      throw new ConsultationRecordError(
        '咨询记录服务配置无效',
        'CONSULTATION_RECORD_SERVICE_CONFIG_INVALID'
      );
    }
    this.adapters = adapters;
    this.auditRepository = auditRepository;
  }

  async readSourceStatuses(projectId) {
    return Promise.all(this.adapters.map(async (adapter) => {
      try {
        return normalizeSourceStatus(await adapter.getStatus({
          projectId: String(projectId)
        }));
      } catch {
        return normalizeSourceStatus({
          sourceSystem: adapter.sourceSystem,
          consultationType: adapter.consultationType,
          sourceState: 'ERROR',
          recordCoverage: 'NONE',
          reasonCode: 'CONSULTATION_SOURCE_STATUS_FAILED'
        });
      }
    }));
  }

  async list({ projectId, query }) {
    const normalizedProjectId = String(projectId);
    const sources = await this.readSourceStatuses(normalizedProjectId);
    const eligible = this.adapters.filter((adapter) => {
      const status = sources.find((source) => (
        source.sourceSystem === adapter.sourceSystem
      ));
      return status
        && status.recordCoverage !== 'NONE'
        && ['AVAILABLE', 'PARTIAL'].includes(status.sourceState)
        && (query.type === 'ALL' || status.consultationType === query.type);
    });
    if (eligible.length === 1 && canUseDirectPage(eligible[0], query)) {
      const adapter = eligible[0];
      try {
        const pageResult = await adapter.listRecordPage({
          projectId: normalizedProjectId,
          query,
          page: query.page,
          pageSize: query.pageSize
        });
        if (pageResult !== null && pageResult !== undefined) {
          if (
            !Number.isSafeInteger(pageResult.totalItems)
            || pageResult.totalItems < 0
            || !Array.isArray(pageResult.items)
            || pageResult.items.length > query.pageSize
          ) {
            throw new ConsultationRecordError(
              '咨询记录来源响应无效',
              'CONSULTATION_RECORD_RESPONSE_INVALID',
              502
            );
          }
          const seen = new Set();
          const items = pageResult.items.map((record) => normalizeSummary(
            record,
            normalizedProjectId
          ));
          const offset = (query.page - 1) * query.pageSize;
          const expectedItemCount = Math.min(
            query.pageSize,
            Math.max(pageResult.totalItems - offset, 0)
          );
          for (const [index, item] of items.entries()) {
            if (
              seen.has(item.id)
              || !matchesQuery(item, query)
              || (index > 0 && compareRecords(items[index - 1], item, query) > 0)
            ) {
              throw new ConsultationRecordError(
                '咨询记录来源响应无效',
                'CONSULTATION_RECORD_RESPONSE_INVALID',
                502
              );
            }
            seen.add(item.id);
          }
          if (items.length !== expectedItemCount) {
            throw new ConsultationRecordError(
              '咨询记录来源分页不完整',
              'CONSULTATION_RECORD_RESPONSE_INVALID',
              502
            );
          }
          return {
            schemaVersion: SCHEMA_VERSION,
            projectId: normalizedProjectId,
            coverage: { from: query.from, to: query.to, timeZone: TIME_ZONE },
            coverageState: coverageState(sources),
            sources,
            items,
            pagination: {
              page: query.page,
              pageSize: query.pageSize,
              totalItems: pageResult.totalItems,
              totalPages: pageResult.totalItems === 0
                ? 0
                : Math.ceil(pageResult.totalItems / query.pageSize)
            }
          };
        }
      } catch {
        const sourceIndex = sources.findIndex((source) => (
          source.sourceSystem === adapter.sourceSystem
        ));
        sources[sourceIndex] = normalizeSourceStatus({
          sourceSystem: adapter.sourceSystem,
          consultationType: adapter.consultationType,
          sourceState: 'ERROR',
          recordCoverage: 'NONE',
          reasonCode: 'CONSULTATION_SOURCE_READ_FAILED'
        });
        throw new ConsultationRecordError(
          '咨询记录来源暂时不可用',
          'CONSULTATION_ALL_SOURCES_FAILED',
          502
        );
      }
    }
    const settled = await Promise.allSettled(eligible.map(async (adapter) => {
      const records = await adapter.listRecords({
        projectId: normalizedProjectId,
        query,
        limit: MAX_ADAPTER_RECORDS + 1
      });
      if (!Array.isArray(records) || records.length > MAX_ADAPTER_RECORDS) {
        throw new ConsultationRecordError(
          '咨询记录来源响应无效',
          'CONSULTATION_RECORD_RESPONSE_INVALID',
          502
        );
      }
      return records.map((record) => normalizeSummary(
        record,
        normalizedProjectId
      ));
    }));
    const batches = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        batches.push(result.value);
        return;
      }
      const adapter = eligible[index];
      const sourceIndex = sources.findIndex((source) => (
        source.sourceSystem === adapter.sourceSystem
      ));
      sources[sourceIndex] = normalizeSourceStatus({
        sourceSystem: adapter.sourceSystem,
        consultationType: adapter.consultationType,
        sourceState: 'ERROR',
        recordCoverage: 'NONE',
        reasonCode: 'CONSULTATION_SOURCE_READ_FAILED'
      });
    });
    if (eligible.length > 0 && batches.length === 0) {
      throw new ConsultationRecordError(
        '咨询记录来源暂时不可用',
        'CONSULTATION_ALL_SOURCES_FAILED',
        502
      );
    }
    const seen = new Set();
    const records = batches.flat().filter((record) => {
      if (seen.has(record.id)) {
        throw new ConsultationRecordError(
          '咨询记录 ID 重复',
          'CONSULTATION_RECORD_RESPONSE_INVALID',
          502
        );
      }
      seen.add(record.id);
      return matchesQuery(record, query);
    }).sort((left, right) => compareRecords(left, right, query));
    const totalItems = records.length;
    const offset = (query.page - 1) * query.pageSize;
    return {
      schemaVersion: SCHEMA_VERSION,
      projectId: normalizedProjectId,
      coverage: { from: query.from, to: query.to, timeZone: TIME_ZONE },
      coverageState: coverageState(sources),
      sources,
      items: records.slice(offset, offset + query.pageSize),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize)
      }
    };
  }

  async detail({ projectId, recordId, userId }) {
    const adapter = this.adapters.find((candidate) => candidate.owns(recordId));
    if (!adapter) {
      throw new ConsultationRecordError(
        '咨询记录不存在',
        'CONSULTATION_RECORD_NOT_FOUND',
        404
      );
    }
    const status = normalizeSourceStatus(await adapter.getStatus({
      projectId: String(projectId)
    }));
    if (
      status.recordCoverage === 'NONE'
      || !['AVAILABLE', 'PARTIAL'].includes(status.sourceState)
    ) {
      throw new ConsultationRecordError(
        '咨询记录来源尚未接入',
        status.reasonCode || 'CONSULTATION_SOURCE_UNAVAILABLE',
        503
      );
    }
    const source = await adapter.getRecord({
      projectId: String(projectId),
      recordId: String(recordId)
    });
    if (!source) {
      throw new ConsultationRecordError(
        '咨询记录不存在',
        'CONSULTATION_RECORD_NOT_FOUND',
        404
      );
    }
    const detail = normalizeDetail(
      source,
      adapter.allowedExternalOrigins,
      String(projectId)
    );
    if (
      detail.sourceSystem !== adapter.sourceSystem
      || detail.consultationType !== adapter.consultationType
      || detail.id !== String(recordId)
    ) {
      throw new ConsultationRecordError(
        '咨询记录来源响应无效',
        'CONSULTATION_RECORD_RESPONSE_INVALID',
        502
      );
    }
    try {
      await this.auditRepository.recordView({
        userId: String(userId),
        projectId: String(projectId),
        sourceSystem: detail.sourceSystem,
        consultationType: detail.consultationType,
        recordId: detail.id
      });
    } catch {
      throw new ConsultationRecordError(
        '咨询详情审计暂时不可用',
        'CONSULTATION_DETAIL_AUDIT_UNAVAILABLE',
        503
      );
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      projectId: String(projectId),
      detail
    };
  }
}

module.exports = { ConsultationRecordService };
