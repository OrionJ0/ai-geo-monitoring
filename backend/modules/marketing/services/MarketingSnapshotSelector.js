const { QueryTypes } = require('sequelize');
const { MarketingRefreshError } = require('./MarketingRefreshService');

function strictDate(value) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
  ) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

class MarketingSnapshotSelector {
  constructor({ sequelize }) {
    this.sequelize = sequelize;
  }

  async selectRevision({ projectId, revision, from, to, transaction }) {
    if (typeof revision !== 'string' || revision.trim() === '') {
      throw new MarketingRefreshError(
        '详情请求必须提供 revision',
        'MARKETING_REVISION_REQUIRED',
        400
      );
    }
    const rows = await this.sequelize.query(
      `SELECT *
       FROM baidu_marketing_refresh_runs
       WHERE project_id = :projectId
         AND id = :revision
         AND status = 'SUCCEEDED'
       LIMIT 1`,
      {
        replacements: { projectId, revision },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    const run = rows[0];
    if (!run) {
      throw new MarketingRefreshError(
        '指定的营销快照不存在',
        'MARKETING_REVISION_NOT_FOUND',
        404
      );
    }
    if (!['DATA', 'ZERO'].includes(run.snapshot_content_state)) {
      throw new MarketingRefreshError(
        '指定的营销快照不可用',
        'MARKETING_SNAPSHOT_UNAVAILABLE',
        409
      );
    }
    if (![true, 1, '1'].includes(run.snapshot_facts_retained)) {
      throw new MarketingRefreshError(
        '指定的营销快照事实已不可用',
        'MARKETING_SNAPSHOT_UNAVAILABLE',
        409
      );
    }
    const requestedFrom = from ?? run.coverage_start;
    const requestedTo = to ?? run.coverage_end;
    if (
      !strictDate(requestedFrom)
      || !strictDate(requestedTo)
      || requestedFrom > requestedTo
      || requestedFrom < run.coverage_start
      || requestedTo > run.coverage_end
    ) {
      throw new MarketingRefreshError(
        '日期筛选超出指定快照覆盖范围',
        'DASHBOARD_DATE_OUT_OF_RANGE',
        422
      );
    }
    return {
      run,
      filter: { from: requestedFrom, to: requestedTo }
    };
  }
}

module.exports = {
  MarketingSnapshotSelector,
  strictDate
};
