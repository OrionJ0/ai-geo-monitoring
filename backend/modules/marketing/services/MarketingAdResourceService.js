const { QueryTypes, Transaction } = require('sequelize');
const {
  MARKETING_AD_READ_CONTRACT
} = require('../contracts/MarketingAdReadContract');
const { addDecimalText } = require('../domain/exactValues');
const { MarketingRefreshError } = require('./MarketingRefreshService');

const SEARCH_TERM_COLUMNS = [
  'external_account_id',
  'campaign_id',
  'ad_group_id',
  'search_term_key'
];
const SEARCH_TERM_SORTS = new Set(
  MARKETING_AD_READ_CONTRACT.resources.searchTerms.sortBy
);

function queryError(message = '搜索词资源查询参数无效') {
  return new MarketingRefreshError(
    message,
    MARKETING_AD_READ_CONTRACT.errors.queryInvalid,
    400
  );
}

function positiveInteger(value, fallback, maximum = null) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    throw queryError();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (maximum && parsed > maximum)) {
    throw queryError();
  }
  return parsed;
}

function optionalText(value, maximum, allowed = null) {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.includes('\u0000')
    || (allowed && !allowed.has(value))
  ) throw queryError();
  return value;
}

function escapeLike(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function exactSumRows(rows) {
  const total = {
    impressions: '0',
    clicks: '0',
    costAmountScaled: '0'
  };
  for (const row of rows) {
    total.impressions = addDecimalText(total.impressions, row.impressions_text);
    total.clicks = addDecimalText(total.clicks, row.clicks_text);
    total.costAmountScaled = addDecimalText(
      total.costAmountScaled,
      row.cost_amount_scaled_text
    );
  }
  return total;
}

function normalizeOptions(options) {
  const pagination = MARKETING_AD_READ_CONTRACT.pagination;
  const page = positiveInteger(options.page, pagination.defaultPage);
  const pageSize = positiveInteger(
    options.pageSize,
    pagination.defaultPageSize,
    pagination.maximumPageSize
  );
  const sortBy = options.sortBy ?? 'impressions';
  const sortOrder = options.sortOrder ?? 'descend';
  if (
    !SEARCH_TERM_SORTS.has(sortBy)
    || !MARKETING_AD_READ_CONTRACT.sortOrders.includes(sortOrder)
  ) throw queryError();
  return {
    page,
    pageSize,
    sortBy,
    sortOrder,
    query: optionalText(options.query, pagination.maximumQueryLength),
    accountId: optionalText(options.accountId, 512),
    campaignId: optionalText(options.campaignId, 512),
    adGroupId: optionalText(options.adGroupId, 512),
    keywordName: optionalText(options.keywordName, 512),
    queryStatus: optionalText(
      options.queryStatus,
      24,
      new Set(['ADDED', 'NOT_ADDED', 'NOT_ADDABLE'])
    ),
    matchType: optionalText(options.matchType, 40)
  };
}

function buildWhere(options, selected) {
  const clauses = [
    'project_id = :projectId',
    'refresh_run_id = :revision',
    'metric_date >= :from',
    'metric_date <= :to'
  ];
  const replacements = {
    projectId: options.projectId,
    revision: selected.run.id,
    from: selected.filter.from,
    to: selected.filter.to
  };
  const exact = [
    ['accountId', 'external_account_id'],
    ['campaignId', 'campaign_id'],
    ['adGroupId', 'ad_group_id'],
    ['keywordName', 'keyword_name'],
    ['queryStatus', 'query_status'],
    ['matchType', 'match_type']
  ];
  for (const [option, column] of exact) {
    if (options[option] !== undefined) {
      clauses.push(`${column} = :${option}`);
      replacements[option] = options[option];
    }
  }
  if (options.query !== undefined) {
    clauses.push("search_term LIKE :query ESCAPE '\\'");
    replacements.query = `%${escapeLike(options.query)}%`;
  }
  return { sql: clauses.join('\n AND '), replacements };
}

function stableOrder(options, dialect) {
  const direction = options.sortOrder === 'ascend' ? 'ASC' : 'DESC';
  const textColumns = {
    searchTerm: 'search_term',
    keywordName: 'keyword_name'
  };
  if (textColumns[options.sortBy]) {
    return `${textColumns[options.sortBy]} ${direction}, ${SEARCH_TERM_COLUMNS.join(' ASC, ')} ASC`;
  }
  const metricColumns = {
    impressions: 'impressions',
    clicks: 'clicks',
    costAmountScaled: 'cost_amount_scaled'
  };
  if (metricColumns[options.sortBy]) {
    const column = metricColumns[options.sortBy];
    if (dialect === 'postgres') {
      return `${column}::numeric ${direction}, ${SEARCH_TERM_COLUMNS.join(' ASC, ')} ASC`;
    }
    return `length(${column}) ${direction}, ${column} ${direction}, ${SEARCH_TERM_COLUMNS.join(' ASC, ')} ASC`;
  }
  const denominator = options.sortBy === 'ctr' ? 'impressions' : 'clicks';
  const numerator = options.sortBy === 'ctr' ? 'clicks' : 'cost_amount_scaled';
  const ratio = dialect === 'postgres'
    ? `${numerator}::numeric / NULLIF(${denominator}::numeric, 0)`
    : `CAST(${numerator} AS REAL) / NULLIF(CAST(${denominator} AS REAL), 0)`;
  return `CASE WHEN ${denominator} = '0' THEN 1 ELSE 0 END ASC, ${ratio} ${direction}, ${SEARCH_TERM_COLUMNS.join(' ASC, ')} ASC`;
}

function postgresAggregateSql(where) {
  return `WITH filtered AS (
    SELECT * FROM baidu_search_term_daily_metrics WHERE ${where}
  )
  SELECT
    external_account_id, campaign_id, MIN(campaign_name) AS campaign_name,
    ad_group_id, MIN(ad_group_name) AS ad_group_name,
    MIN(keyword_name) AS keyword_name, MIN(search_term) AS search_term,
    search_term_key, MIN(query_status) AS query_status,
    MIN(match_type) AS match_type,
    SUM(impressions_text::numeric)::text AS impressions,
    SUM(clicks_text::numeric)::text AS clicks,
    SUM(cost_amount_scaled_text::numeric)::text AS cost_amount_scaled
  FROM filtered
  GROUP BY external_account_id, campaign_id, ad_group_id, search_term_key`;
}

function sqliteAggregateSql(where) {
  return `WITH RECURSIVE
  filtered AS (
    SELECT * FROM baidu_search_term_daily_metrics WHERE ${where}
  ),
  identities AS (
    SELECT
      row_number() OVER (
        ORDER BY external_account_id, campaign_id, ad_group_id, search_term_key
      ) AS group_index,
      external_account_id, campaign_id, MIN(campaign_name) AS campaign_name,
      ad_group_id, MIN(ad_group_name) AS ad_group_name,
      MIN(keyword_name) AS keyword_name, MIN(search_term) AS search_term,
      search_term_key, MIN(query_status) AS query_status,
      MIN(match_type) AS match_type
    FROM filtered
    GROUP BY external_account_id, campaign_id, ad_group_id, search_term_key
  ),
  metric_rows AS (
    SELECT i.group_index, 'impressions' AS metric, f.impressions_text AS value
    FROM filtered f JOIN identities i USING (
      external_account_id, campaign_id, ad_group_id, search_term_key
    )
    UNION ALL
    SELECT i.group_index, 'clicks', f.clicks_text
    FROM filtered f JOIN identities i USING (
      external_account_id, campaign_id, ad_group_id, search_term_key
    )
    UNION ALL
    SELECT i.group_index, 'cost_amount_scaled', f.cost_amount_scaled_text
    FROM filtered f JOIN identities i USING (
      external_account_id, campaign_id, ad_group_id, search_term_key
    )
  ),
  max_lengths AS (
    SELECT group_index, metric, MAX(length(value)) AS max_pos
    FROM metric_rows GROUP BY group_index, metric
  ),
  positions(group_index, metric, pos, max_pos) AS (
    SELECT group_index, metric, 1, max_pos FROM max_lengths
    UNION ALL
    SELECT group_index, metric, pos + 1, max_pos
    FROM positions WHERE pos < max_pos
  ),
  digit_sums AS (
    SELECT p.group_index, p.metric, p.pos, p.max_pos,
      SUM(CAST(substr(m.value, -p.pos, 1) AS INTEGER)) AS digit_sum
    FROM positions p
    JOIN metric_rows m
      ON m.group_index = p.group_index AND m.metric = p.metric
    GROUP BY p.group_index, p.metric, p.pos, p.max_pos
  ),
  exact_digits(group_index, metric, pos, max_pos, carry, value) AS (
    SELECT group_index, metric, pos, max_pos,
      CAST(digit_sum / 10 AS INTEGER),
      CAST(digit_sum % 10 AS TEXT)
    FROM digit_sums WHERE pos = 1
    UNION ALL
    SELECT s.group_index, s.metric, s.pos, s.max_pos,
      CAST((s.digit_sum + d.carry) / 10 AS INTEGER),
      CAST((s.digit_sum + d.carry) % 10 AS TEXT) || d.value
    FROM exact_digits d
    JOIN digit_sums s
      ON s.group_index = d.group_index
      AND s.metric = d.metric
      AND s.pos = d.pos + 1
  ),
  exact_sums AS (
    SELECT group_index, metric,
      COALESCE(NULLIF(ltrim(
        CASE WHEN carry = 0 THEN value ELSE CAST(carry AS TEXT) || value END,
        '0'
      ), ''), '0') AS exact_value
    FROM exact_digits WHERE pos = max_pos
  ),
  totals AS (
    SELECT group_index,
      MAX(CASE WHEN metric = 'impressions' THEN exact_value END) AS impressions,
      MAX(CASE WHEN metric = 'clicks' THEN exact_value END) AS clicks,
      MAX(CASE WHEN metric = 'cost_amount_scaled' THEN exact_value END) AS cost_amount_scaled
    FROM exact_sums GROUP BY group_index
  )
  SELECT i.*, t.impressions, t.clicks, t.cost_amount_scaled
  FROM identities i JOIN totals t USING (group_index)`;
}

class MarketingAdResourceService {
  constructor({ sequelize, snapshotSelector }) {
    this.sequelize = sequelize;
    this.snapshotSelector = snapshotSelector;
  }

  async readSearchTerms(input) {
    const options = { ...input, ...normalizeOptions(input) };
    const transactionOptions = this.sequelize.getDialect() === 'postgres'
      ? {
          isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ,
          readOnly: true
        }
      : {};
    return this.sequelize.transaction(transactionOptions, async (transaction) => {
      const selected = await this.snapshotSelector.selectRevision({
        ...input,
        transaction
      });
      const where = buildWhere(options, selected);
      const dialect = this.sequelize.getDialect();
      const aggregateSql = dialect === 'postgres'
        ? postgresAggregateSql(where.sql)
        : sqliteAggregateSql(where.sql);
      const replacements = {
        ...where.replacements,
        limit: options.pageSize,
        offset: (options.page - 1) * options.pageSize
      };
      const items = await this.sequelize.query(
        `SELECT * FROM (${aggregateSql}) aggregated_terms
         ORDER BY ${stableOrder(options, dialect)}
         LIMIT :limit OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT, transaction }
      );
      const countRows = await this.sequelize.query(
        `SELECT COUNT(*) AS total
         FROM (
           SELECT 1
           FROM baidu_search_term_daily_metrics
           WHERE ${where.sql}
           GROUP BY ${SEARCH_TERM_COLUMNS.join(', ')}
         ) grouped_terms`,
        {
          replacements: where.replacements,
          type: QueryTypes.SELECT,
          transaction
        }
      );
      const summaryRows = await this.sequelize.query(
        `SELECT impressions_text, clicks_text, cost_amount_scaled_text
         FROM baidu_search_term_daily_metrics
         WHERE ${where.sql}`,
        {
          replacements: where.replacements,
          type: QueryTypes.SELECT,
          transaction
        }
      );
      const itemKeys = new Set(items.map((item) => [
        item.external_account_id,
        item.campaign_id,
        item.ad_group_id,
        item.search_term_key
      ].join('\u0000')));
      const trendRows = itemKeys.size === 0
        ? []
        : await this.sequelize.query(
            `SELECT *
             FROM baidu_search_term_daily_metrics
             WHERE ${where.sql}
             ORDER BY metric_date ASC`,
            {
              replacements: where.replacements,
              type: QueryTypes.SELECT,
              transaction
            }
          );
      const trendByKey = new Map();
      for (const row of trendRows) {
        const key = SEARCH_TERM_COLUMNS.map((column) => row[column]).join('\u0000');
        if (!itemKeys.has(key)) continue;
        if (!trendByKey.has(key)) trendByKey.set(key, new Map());
        const byDate = trendByKey.get(key);
        if (!byDate.has(row.metric_date)) {
          byDate.set(row.metric_date, {
            date: row.metric_date,
            impressions: '0',
            clicks: '0',
            costAmountScaled: '0'
          });
        }
        const point = byDate.get(row.metric_date);
        point.impressions = addDecimalText(point.impressions, row.impressions_text);
        point.clicks = addDecimalText(point.clicks, row.clicks_text);
        point.costAmountScaled = addDecimalText(
          point.costAmountScaled,
          row.cost_amount_scaled_text
        );
      }
      const totalItems = Number(countRows[0]?.total || 0);
      return {
        schemaVersion: MARKETING_AD_READ_CONTRACT.resources.searchTerms.schemaVersion,
        projectId: String(input.projectId),
        revision: selected.run.id,
        coverage: {
          from: selected.run.coverage_start,
          to: selected.run.coverage_end,
          lastSuccessfulAt: selected.run.finished_at,
          currency: selected.run.currency_code,
          costScale: Number(selected.run.cost_scale)
        },
        filter: selected.filter,
        summary: exactSumRows(summaryRows),
        items: items.map((item) => {
          const key = SEARCH_TERM_COLUMNS.map((column) => item[column]).join('\u0000');
          return {
            accountId: item.external_account_id,
            campaignId: item.campaign_id,
            campaignName: item.campaign_name,
            adGroupId: item.ad_group_id,
            adGroupName: item.ad_group_name,
            keywordName: item.keyword_name,
            searchTerm: item.search_term,
            queryStatus: item.query_status,
            matchType: item.match_type,
            impressions: item.impressions,
            clicks: item.clicks,
            costAmountScaled: item.cost_amount_scaled,
            trend: [...(trendByKey.get(key)?.values() || [])]
          };
        }),
        pagination: {
          page: options.page,
          pageSize: options.pageSize,
          totalItems,
          totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / options.pageSize)
        }
      };
    });
  }
}

module.exports = {
  MarketingAdResourceService
};
