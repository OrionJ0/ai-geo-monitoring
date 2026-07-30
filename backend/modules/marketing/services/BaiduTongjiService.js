const { QueryTypes } = require('sequelize');
const {
  parseProjectAllowlist,
  projectAllowed
} = require('../domain/projectAllowlist');
const { fixedShanghaiWindow } = require('../domain/syncWindow');

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
        '项目包含多个百度授权连接，无法自动选择统计站点',
        'TONGJI_CONNECTION_AMBIGUOUS',
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
    if (
      !result?.site
      || typeof result.site.siteId !== 'string'
      || typeof result.site.domain !== 'string'
      || result.site.status !== 'ACTIVE'
      || !Array.isArray(result.rows)
    ) {
      throw new BaiduTongjiError(
        '百度统计响应无效',
        'TONGJI_RESPONSE_INVALID',
        502
      );
    }
    const rows = result.rows.map((row) => {
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
    const summary = {
      pageviews: sumMetric(rows, 'pageviews'),
      visits: sumMetric(rows, 'visits'),
      visitors: sumMetric(rows, 'visitors')
    };
    return {
      projectId: String(projectId),
      source: 'BAIDU_TONGJI',
      mode: 'LIVE_PILOT',
      site: {
        siteId: result.site.siteId,
        domain: result.site.domain
      },
      coverage,
      dataState: Object.values(summary).some((value) => value !== null)
        ? 'DATA'
        : 'NO_DATA',
      summary,
      trend: rows
    };
  }
}

module.exports = {
  BaiduTongjiError,
  BaiduTongjiService
};
