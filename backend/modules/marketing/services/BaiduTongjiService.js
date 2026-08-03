const { QueryTypes } = require('sequelize');
const {
  parseProjectAllowlist,
  projectAllowed
} = require('../domain/projectAllowlist');
const { fixedShanghaiWindow } = require('../domain/syncWindow');

const TONGJI_SOURCE_DEFINITIONS = Object.freeze([
  { sourceKey: 'DIRECT', sourceLabel: '直接访问' },
  { sourceKey: 'SEARCH', sourceLabel: '搜索引擎' },
  { sourceKey: 'EXTERNAL', sourceLabel: '外部链接' }
]);

class BaiduTongjiError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function sumMetric(rows, field) {
  let total = 0n;
  let observed = false;
  for (const row of rows) {
    const value = row[field];
    if (value == null) continue;
    if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
      throw new BaiduTongjiError(
        '百度统计指标无效',
        'TONGJI_RESPONSE_INVALID',
        502
      );
    }
    observed = true;
    total += BigInt(value);
  }
  return observed ? total.toString() : null;
}

function normalizeSite(site) {
  if (
    !site
    || typeof site.siteId !== 'string'
    || typeof site.domain !== 'string'
    || site.status !== 'ACTIVE'
  ) {
    throw new BaiduTongjiError(
      '百度统计响应无效',
      'TONGJI_RESPONSE_INVALID',
      502
    );
  }
  return {
    siteId: site.siteId,
    domain: site.domain
  };
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) {
    throw new BaiduTongjiError(
      '百度统计响应无效',
      'TONGJI_RESPONSE_INVALID',
      502
    );
  }
  return rows.map((row) => {
    if (
      typeof row?.date !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/u.test(row.date)
    ) {
      throw new BaiduTongjiError(
        '百度统计趋势日期无效',
        'TONGJI_RESPONSE_INVALID',
        502
      );
    }
    return {
      date: row.date,
      pageviews: row.pageviews,
      visits: row.visits,
      visitors: row.visitors
    };
  });
}

function summarizeRows(rows) {
  return {
    pageviews: sumMetric(rows, 'pageviews'),
    visits: sumMetric(rows, 'visits'),
    visitors: sumMetric(rows, 'visitors')
  };
}

function dataState(summary) {
  return Object.values(summary).some((value) => value !== null)
    ? 'DATA'
    : 'NO_DATA';
}

class BaiduTongjiService {
  constructor({
    sequelize,
    provider,
    allowedProjectIds = '*',
    clock = () => Date.now()
  }) {
    this.sequelize = sequelize;
    this.provider = provider;
    this.projectAllowlist = parseProjectAllowlist(allowedProjectIds);
    this.clock = clock;
  }

  assertProjectAllowed(projectId) {
    if (!projectAllowed(this.projectAllowlist, projectId)) {
      throw new BaiduTongjiError(
        '项目不在营销监控试点范围',
        'MARKETING_PROJECT_NOT_ALLOWED',
        403
      );
    }
  }

  async getProjectAndConnection(projectId) {
    this.assertProjectAllowed(projectId);
    const projects = await this.sequelize.query(
      `SELECT id, status
       FROM brand_projects
       WHERE id = :projectId
       LIMIT 1`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT
      }
    );
    if (!projects[0]) {
      throw new BaiduTongjiError(
        '项目不存在',
        'PROJECT_NOT_FOUND',
        404
      );
    }
    if (projects[0].status !== 'active') {
      throw new BaiduTongjiError(
        '归档项目不读取百度统计实时数据',
        'PROJECT_ARCHIVED',
        409
      );
    }
    const connections = await this.sequelize.query(
      `SELECT DISTINCT
         b.id AS binding_id,
         b.external_account_id,
         b.tongji_site_id,
         b.tongji_site_domain,
         c.id,
         c.authorized_principal_id,
         c.authorized_open_id
       FROM baidu_project_bindings b
       JOIN baidu_marketing_connections c ON c.id = b.connection_id
       WHERE b.project_id = :projectId
         AND b.status = 'ACTIVE'
         AND c.status = 'CONNECTED'
       ORDER BY c.id ASC`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT
      }
    );
    if (connections.length === 0) {
      throw new BaiduTongjiError(
        '项目尚未绑定可用的百度账户',
        'TONGJI_CONNECTION_MISSING',
        409
      );
    }
    if (connections.length > 1) {
      throw new BaiduTongjiError(
        '项目包含多个活动百度统计绑定',
        'TONGJI_BINDING_AMBIGUOUS',
        409
      );
    }
    if (
      typeof connections[0].tongji_site_id !== 'string'
      || !/^\d+$/u.test(connections[0].tongji_site_id)
      || typeof connections[0].tongji_site_domain !== 'string'
      || !connections[0].tongji_site_domain
    ) {
      throw new BaiduTongjiError(
        '项目绑定缺少明确的百度统计站点',
        'TONGJI_SITE_BINDING_MISSING',
        409
      );
    }
    return {
      project: projects[0],
      connection: connections[0]
    };
  }

  async readProjectTrend(projectId) {
    const { connection } = await this.getProjectAndConnection(projectId);
    const coverage = fixedShanghaiWindow(this.clock());
    const result = await this.provider.readTrend({
      connection,
      coverage
    });
    const site = normalizeSite(result?.site);
    const rows = normalizeRows(result?.rows);
    const summary = summarizeRows(rows);
    return {
      projectId: String(projectId),
      source: 'BAIDU_TONGJI',
      mode: 'LIVE_PILOT',
      site,
      coverage,
      dataState: dataState(summary),
      summary,
      trend: rows
    };
  }

  async readProjectSourceTrends(projectId) {
    const { connection } = await this.getProjectAndConnection(projectId);
    const coverage = fixedShanghaiWindow(this.clock());
    const sourceKeys = TONGJI_SOURCE_DEFINITIONS.map(
      (definition) => definition.sourceKey
    );
    const result = await this.provider.readSourceTrends({
      connection,
      coverage,
      sourceKeys
    });
    const site = normalizeSite(result?.site);
    if (!Array.isArray(result?.sources) || result.sources.length !== sourceKeys.length) {
      throw new BaiduTongjiError(
        '百度统计来源响应无效',
        'TONGJI_SOURCE_RESPONSE_INVALID',
        502
      );
    }
    const byKey = new Map(result.sources.map((source) => [source?.sourceKey, source]));
    if (byKey.size !== sourceKeys.length) {
      throw new BaiduTongjiError(
        '百度统计来源响应无效',
        'TONGJI_SOURCE_RESPONSE_INVALID',
        502
      );
    }
    const sources = TONGJI_SOURCE_DEFINITIONS.map((definition) => {
      const source = byKey.get(definition.sourceKey);
      if (!source) {
        throw new BaiduTongjiError(
          '百度统计来源响应无效',
          'TONGJI_SOURCE_RESPONSE_INVALID',
          502
        );
      }
      const trend = normalizeRows(source.rows);
      const summary = summarizeRows(trend);
      return {
        ...definition,
        dataState: dataState(summary),
        summary,
        trend
      };
    });
    return {
      projectId: String(projectId),
      source: 'BAIDU_TONGJI',
      mode: 'LIVE_PILOT',
      site,
      coverage,
      dataState: sources.some((source) => source.dataState === 'DATA')
        ? 'DATA'
        : 'NO_DATA',
      attribution: {
        level: 'WEBSITE_TRAFFIC_SOURCE',
        isCrossSystemVerified: false
      },
      sources
    };
  }
}

module.exports = {
  BaiduTongjiError,
  BaiduTongjiService
};
