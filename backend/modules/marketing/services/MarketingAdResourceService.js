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
const KEYWORD_COLUMNS = [
  'external_account_id',
  'campaign_id',
  'ad_group_id',
  'keyword_id'
];
const SEARCH_TERM_SORTS = new Set(
  MARKETING_AD_READ_CONTRACT.resources.searchTerms.sortBy
);
const KEYWORD_SORTS = new Set(
  MARKETING_AD_READ_CONTRACT.resources.keywords.sortBy
);

function queryError(message = '搜索词资源查询参数无效') {
  return new MarketingRefreshError(
    message,
    MARKETING_AD_READ_CONTRACT.errors.queryInvalid,
    400
  );
}

function sortScopeTooLarge(message) {
  return new MarketingRefreshError(
    message,
    MARKETING_AD_READ_CONTRACT.errors.sortScopeTooLarge,
    422
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

function unavailableHierarchy() {
  return new MarketingRefreshError(
    '指定的营销层级快照不完整',
    MARKETING_AD_READ_CONTRACT.errors.snapshotUnavailable,
    409
  );
}

function aggregateHierarchyRows(rows, identityColumns, fields) {
  const facts = new Set();
  const items = new Map();
  for (const row of rows) {
    const identity = identityColumns.map((column) => row[column]).join('\u0000');
    const factIdentity = `${identity}\u0000${row.metric_date}`;
    if (facts.has(factIdentity)) throw unavailableHierarchy();
    facts.add(factIdentity);
    if (!items.has(identity)) {
      items.set(identity, {
        ...Object.fromEntries(fields.map(([target, source]) => [target, row[source]])),
        impressions: '0',
        clicks: '0',
        costAmountScaled: '0',
        trend: []
      });
    }
    const item = items.get(identity);
    if (fields.some(([target, source]) => item[target] !== row[source])) {
      throw unavailableHierarchy();
    }
    item.impressions = addDecimalText(item.impressions, row.impressions_text);
    item.clicks = addDecimalText(item.clicks, row.clicks_text);
    item.costAmountScaled = addDecimalText(
      item.costAmountScaled,
      row.cost_amount_scaled_text
    );
    let point = item.trend.at(-1);
    if (!point || point.date !== row.metric_date) {
      point = {
        date: row.metric_date,
        impressions: '0',
        clicks: '0',
        costAmountScaled: '0'
      };
      item.trend.push(point);
    }
    point.impressions = addDecimalText(point.impressions, row.impressions_text);
    point.clicks = addDecimalText(point.clicks, row.clicks_text);
    point.costAmountScaled = addDecimalText(
      point.costAmountScaled,
      row.cost_amount_scaled_text
    );
  }
  return [...items.values()];
}

function assertStrictHierarchy(campaigns, adGroups, keywords) {
  const campaignParents = new Map(campaigns.map((row) => [
    [row.accountId, row.campaignId].join('\u0000'),
    row.campaignName
  ]));
  for (const row of adGroups) {
    if (campaignParents.get(
      [row.accountId, row.campaignId].join('\u0000')
    ) !== row.campaignName) throw unavailableHierarchy();
  }
  const adGroupParents = new Map(adGroups.map((row) => [
    [row.accountId, row.campaignId, row.adGroupId].join('\u0000'),
    [row.campaignName, row.adGroupName]
  ]));
  for (const row of keywords) {
    const parent = adGroupParents.get(
      [row.accountId, row.campaignId, row.adGroupId].join('\u0000')
    );
    if (
      !parent
      || parent[0] !== row.campaignName
      || parent[1] !== row.adGroupName
    ) throw unavailableHierarchy();
  }
}

function normalizeOptions(options) {
  const pagination = MARKETING_AD_READ_CONTRACT.pagination;
  const lengths = MARKETING_AD_READ_CONTRACT.filterMaximumLengths;
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
    accountId: optionalText(options.accountId, lengths.accountId),
    campaignId: optionalText(options.campaignId, lengths.campaignId),
    adGroupId: optionalText(options.adGroupId, lengths.adGroupId),
    keywordName: optionalText(options.keywordName, lengths.keywordName),
    queryStatus: optionalText(
      options.queryStatus,
      lengths.queryStatus,
      new Set(['ADDED', 'NOT_ADDED', 'NOT_ADDABLE'])
    ),
    matchType: optionalText(options.matchType, lengths.matchType)
  };
}

function normalizeKeywordOptions(options) {
  const pagination = MARKETING_AD_READ_CONTRACT.pagination;
  const lengths = MARKETING_AD_READ_CONTRACT.filterMaximumLengths;
  const page = positiveInteger(options.page, pagination.defaultPage);
  const pageSize = positiveInteger(
    options.pageSize,
    pagination.defaultPageSize,
    pagination.maximumPageSize
  );
  const sortBy = options.sortBy ?? 'impressions';
  const sortOrder = options.sortOrder ?? 'descend';
  if (
    !KEYWORD_SORTS.has(sortBy)
    || !MARKETING_AD_READ_CONTRACT.sortOrders.includes(sortOrder)
  ) throw queryError('关键词资源查询参数无效');
  return {
    page,
    pageSize,
    sortBy,
    sortOrder,
    query: optionalText(options.query, pagination.maximumQueryLength),
    campaignId: optionalText(options.campaignId, lengths.campaignId),
    adGroupId: optionalText(options.adGroupId, lengths.adGroupId)
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

function buildKeywordWhere(options, selected) {
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
  for (const [option, column] of [
    ['campaignId', 'campaign_id'],
    ['adGroupId', 'ad_group_id']
  ]) {
    if (options[option] !== undefined) {
      clauses.push(`${column} = :${option}`);
      replacements[option] = options[option];
    }
  }
  if (options.query !== undefined) {
    clauses.push("keyword_name LIKE :query ESCAPE '\\'");
    replacements.query = `%${escapeLike(options.query)}%`;
  }
  return { sql: clauses.join('\n AND '), replacements };
}

function keywordResponseFilter(options, selected) {
  return {
    ...selected.filter,
    ...(options.query === undefined ? {} : { query: options.query }),
    ...(options.campaignId === undefined ? {} : { campaignId: options.campaignId }),
    ...(options.adGroupId === undefined ? {} : { adGroupId: options.adGroupId })
  };
}

function buildPageIdentityWhere(items, columns) {
  const replacements = {};
  const clauses = items.map((item, itemIndex) => `(${columns.map((column) => {
    const parameter = `page_${itemIndex}_${column}`;
    replacements[parameter] = item[column];
    return `${column} = :${parameter}`;
  }).join(' AND ')})`);
  return {
    sql: clauses.length ? `(${clauses.join(' OR ')})` : '1 = 0',
    replacements
  };
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
    : 'exact_ratio_rank';
  return `CASE WHEN ${denominator} = '0' THEN 1 ELSE 0 END ASC, ${ratio} ${direction}, ${SEARCH_TERM_COLUMNS.join(' ASC, ')} ASC`;
}

function stableKeywordOrder(options, dialect) {
  const direction = options.sortOrder === 'ascend' ? 'ASC' : 'DESC';
  if (options.sortBy === 'keywordName') {
    return `keyword_name ${direction}, ${KEYWORD_COLUMNS.join(' ASC, ')} ASC`;
  }
  const metricColumns = {
    impressions: 'impressions',
    clicks: 'clicks',
    costAmountScaled: 'cost_amount_scaled'
  };
  if (metricColumns[options.sortBy]) {
    const column = metricColumns[options.sortBy];
    return dialect === 'postgres'
      ? `${column}::numeric ${direction}, ${KEYWORD_COLUMNS.join(' ASC, ')} ASC`
      : `length(${column}) ${direction}, ${column} ${direction}, ${KEYWORD_COLUMNS.join(' ASC, ')} ASC`;
  }
  const denominator = options.sortBy === 'ctr' ? 'impressions' : 'clicks';
  const numerator = options.sortBy === 'ctr' ? 'clicks' : 'cost_amount_scaled';
  const ratio = dialect === 'postgres'
    ? `${numerator}::numeric / NULLIF(${denominator}::numeric, 0)`
    : 'exact_ratio_rank';
  return `CASE WHEN ${denominator} = '0' THEN 1 ELSE 0 END ASC, ${ratio} ${direction}, ${KEYWORD_COLUMNS.join(' ASC, ')} ASC`;
}

function compareIdentity(left, right, columns) {
  for (const column of columns) {
    if (left[column] < right[column]) return -1;
    if (left[column] > right[column]) return 1;
  }
  return 0;
}

function compareExactRatio(left, right, numerator, denominator, options, columns) {
  const leftZero = left[denominator] === '0';
  const rightZero = right[denominator] === '0';
  if (leftZero !== rightZero) return leftZero ? 1 : -1;
  if (!leftZero) {
    const leftProduct = BigInt(left[numerator]) * BigInt(right[denominator]);
    const rightProduct = BigInt(right[numerator]) * BigInt(left[denominator]);
    if (leftProduct !== rightProduct) {
      const comparison = leftProduct < rightProduct ? -1 : 1;
      return options.sortOrder === 'ascend' ? comparison : -comparison;
    }
  }
  return compareIdentity(left, right, columns);
}

function aggregateExactFacts(rows, identityColumns, textColumns) {
  const aggregated = new Map();
  const summary = {
    impressions: '0',
    clicks: '0',
    costAmountScaled: '0'
  };
  for (const row of rows) {
    const key = identityColumns.map((column) => row[column]).join('\u0000');
    if (!aggregated.has(key)) {
      aggregated.set(key, {
        ...Object.fromEntries(identityColumns.map((column) => [column, row[column]])),
        ...Object.fromEntries(textColumns.map((column) => [column, row[column]])),
        impressions: '0',
        clicks: '0',
        cost_amount_scaled: '0'
      });
    }
    const item = aggregated.get(key);
    for (const column of textColumns) {
      if (row[column] < item[column]) item[column] = row[column];
    }
    item.impressions = addDecimalText(item.impressions, row.impressions_text);
    item.clicks = addDecimalText(item.clicks, row.clicks_text);
    item.cost_amount_scaled = addDecimalText(
      item.cost_amount_scaled,
      row.cost_amount_scaled_text
    );
    summary.impressions = addDecimalText(summary.impressions, row.impressions_text);
    summary.clicks = addDecimalText(summary.clicks, row.clicks_text);
    summary.costAmountScaled = addDecimalText(
      summary.costAmountScaled,
      row.cost_amount_scaled_text
    );
  }
  return { items: [...aggregated.values()], summary };
}

function exactFactColumns(identityColumns, textColumns) {
  return [...new Set([
    ...identityColumns,
    ...textColumns,
    'impressions_text',
    'clicks_text',
    'cost_amount_scaled_text'
  ])].join(', ');
}

function postgresExactSummarySql(table, where) {
  return `SELECT
    COALESCE(SUM(impressions_text::numeric), 0)::text AS impressions,
    COALESCE(SUM(clicks_text::numeric), 0)::text AS clicks,
    COALESCE(SUM(cost_amount_scaled_text::numeric), 0)::text AS cost_amount_scaled
  FROM ${table} WHERE ${where}`;
}

async function sqliteExactSummary({
  sequelize,
  table,
  where,
  replacements,
  transaction
}) {
  const metrics = [
    ['impressions', 'impressions_text'],
    ['clicks', 'clicks_text'],
    ['cost_amount_scaled', 'cost_amount_scaled_text']
  ];
  const lengthRows = await sequelize.query(
    `SELECT COUNT(*) AS total_facts,
       MAX(length(impressions_text)) AS impressions_length,
       MAX(length(clicks_text)) AS clicks_length,
       MAX(length(cost_amount_scaled_text)) AS cost_amount_scaled_length
     FROM ${table} WHERE ${where}`,
    { replacements, type: QueryTypes.SELECT, transaction }
  );
  const lengths = lengthRows[0] || {};
  if (Number(lengths.total_facts || 0) === 0) return exactSummary(null);
  const limbDigits = 6;
  const expressions = [];
  for (const [metric, column] of metrics) {
    const limbCount = Math.ceil(Number(lengths[`${metric}_length`] || 0) / limbDigits);
    for (let limb = 0; limb < limbCount; limb += 1) {
      expressions.push(
        `COALESCE(SUM(CAST(substr(${column}, -${(limb + 1) * limbDigits}, ${limbDigits}) AS INTEGER)), 0) AS ${metric}_${limb}`
      );
    }
  }
  const rows = await sequelize.query(
    `SELECT ${expressions.join(', ')} FROM ${table} WHERE ${where}`,
    { replacements, type: QueryTypes.SELECT, transaction }
  );
  const limbs = rows[0] || {};
  const summary = {};
  for (const [metric] of metrics) {
    const limbCount = Math.ceil(Number(lengths[`${metric}_length`] || 0) / limbDigits);
    let total = 0n;
    for (let limb = 0; limb < limbCount; limb += 1) {
      total += BigInt(String(limbs[`${metric}_${limb}`] || 0))
        * (10n ** BigInt(limb * limbDigits));
    }
    summary[metric] = total.toString();
  }
  return exactSummary(summary);
}

function exactSummary(row) {
  return {
    impressions: String(row?.impressions || '0'),
    clicks: String(row?.clicks || '0'),
    costAmountScaled: String(row?.cost_amount_scaled || '0')
  };
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

function postgresKeywordAggregateSql(where) {
  return `WITH filtered AS (
    SELECT * FROM baidu_keyword_daily_metrics WHERE ${where}
  )
  SELECT
    external_account_id, campaign_id, MIN(campaign_name) AS campaign_name,
    ad_group_id, MIN(ad_group_name) AS ad_group_name,
    keyword_id, MIN(keyword_name) AS keyword_name,
    MIN(targeting_type) AS targeting_type,
    SUM(impressions_text::numeric)::text AS impressions,
    SUM(clicks_text::numeric)::text AS clicks,
    SUM(cost_amount_scaled_text::numeric)::text AS cost_amount_scaled
  FROM filtered
  GROUP BY external_account_id, campaign_id, ad_group_id, keyword_id`;
}

function sqliteKeywordAggregateSql(where) {
  return `WITH RECURSIVE
  filtered AS (
    SELECT * FROM baidu_keyword_daily_metrics WHERE ${where}
  ),
  identities AS (
    SELECT
      row_number() OVER (
        ORDER BY external_account_id, campaign_id, ad_group_id, keyword_id
      ) AS group_index,
      external_account_id, campaign_id, MIN(campaign_name) AS campaign_name,
      ad_group_id, MIN(ad_group_name) AS ad_group_name,
      keyword_id, MIN(keyword_name) AS keyword_name,
      MIN(targeting_type) AS targeting_type
    FROM filtered
    GROUP BY external_account_id, campaign_id, ad_group_id, keyword_id
  ),
  metric_rows AS (
    SELECT i.group_index, 'impressions' AS metric, f.impressions_text AS value
    FROM filtered f JOIN identities i USING (
      external_account_id, campaign_id, ad_group_id, keyword_id
    )
    UNION ALL
    SELECT i.group_index, 'clicks', f.clicks_text
    FROM filtered f JOIN identities i USING (
      external_account_id, campaign_id, ad_group_id, keyword_id
    )
    UNION ALL
    SELECT i.group_index, 'cost_amount_scaled', f.cost_amount_scaled_text
    FROM filtered f JOIN identities i USING (
      external_account_id, campaign_id, ad_group_id, keyword_id
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

  async readAdHierarchy(input) {
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
      const replacements = {
        projectId: input.projectId,
        revision: selected.run.id,
        from: selected.filter.from,
        to: selected.filter.to
      };
      const readFacts = (table, orderBy) => this.sequelize.query(
        `SELECT * FROM ${table}
         WHERE project_id = :projectId
           AND refresh_run_id = :revision
           AND metric_date >= :from
           AND metric_date <= :to
         ORDER BY metric_date ASC, binding_id ASC, ${orderBy}`,
        { replacements, type: QueryTypes.SELECT, transaction }
      );
      const [campaignFacts, adGroupFacts, keywordFacts] = await Promise.all([
        readFacts('baidu_campaign_daily_metrics', 'campaign_id ASC'),
        readFacts(
          'baidu_ad_group_daily_metrics',
          'campaign_id ASC, ad_group_id ASC'
        ),
        readFacts(
          'baidu_keyword_daily_metrics',
          'campaign_id ASC, ad_group_id ASC, keyword_id ASC'
        )
      ]);
      const campaigns = aggregateHierarchyRows(
        campaignFacts,
        ['external_account_id', 'campaign_id'],
        [
          ['accountId', 'external_account_id'],
          ['campaignId', 'campaign_id'],
          ['campaignName', 'campaign_name']
        ]
      );
      const adGroups = aggregateHierarchyRows(
        adGroupFacts,
        ['external_account_id', 'campaign_id', 'ad_group_id'],
        [
          ['accountId', 'external_account_id'],
          ['campaignId', 'campaign_id'],
          ['campaignName', 'campaign_name'],
          ['adGroupId', 'ad_group_id'],
          ['adGroupName', 'ad_group_name']
        ]
      );
      const keywords = aggregateHierarchyRows(
        keywordFacts,
        ['external_account_id', 'campaign_id', 'ad_group_id', 'keyword_id'],
        [
          ['accountId', 'external_account_id'],
          ['campaignId', 'campaign_id'],
          ['campaignName', 'campaign_name'],
          ['adGroupId', 'ad_group_id'],
          ['adGroupName', 'ad_group_name'],
          ['keywordId', 'keyword_id'],
          ['keywordName', 'keyword_name'],
          ['targetingType', 'targeting_type']
        ]
      );
      assertStrictHierarchy(campaigns, adGroups, keywords);
      if (
        selected.run.snapshot_content_state === 'ZERO'
        && (campaigns.length || adGroups.length || keywords.length)
      ) throw unavailableHierarchy();
      return {
        schemaVersion: MARKETING_AD_READ_CONTRACT.resources.adHierarchy.schemaVersion,
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
        summary: exactSumRows(campaignFacts),
        campaigns,
        adGroups,
        keywords,
        hierarchyCounts: {
          campaigns: campaigns.length,
          adGroups: adGroups.length,
          keywords: keywords.length
        }
      };
    });
  }

  async readKeywords(input) {
    const options = { ...input, ...normalizeKeywordOptions(input) };
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
      const where = buildKeywordWhere(options, selected);
      const dialect = this.sequelize.getDialect();
      const aggregateSql = dialect === 'postgres'
        ? postgresKeywordAggregateSql(where.sql)
        : sqliteKeywordAggregateSql(where.sql);
      const ratioNumerator = options.sortBy === 'ctr'
        ? 'clicks'
        : 'cost_amount_scaled';
      const ratioDenominator = options.sortBy === 'ctr'
        ? 'impressions'
        : 'clicks';
      const sqliteRatioSort = dialect === 'sqlite'
        && ['ctr', 'averageCpc'].includes(options.sortBy);
      const replacements = {
        ...where.replacements,
        limit: options.pageSize,
        offset: (options.page - 1) * options.pageSize
      };
      let items;
      let totalItems;
      let exactRatioSummary = null;
      if (sqliteRatioSort) {
        const countRows = await this.sequelize.query(
          `SELECT COUNT(*) AS total, COALESCE(SUM(fact_count), 0) AS total_facts
           FROM (
             SELECT COUNT(*) AS fact_count
             FROM baidu_keyword_daily_metrics
             WHERE ${where.sql}
             GROUP BY ${KEYWORD_COLUMNS.join(', ')}
           ) grouped_keywords`,
          {
            replacements: where.replacements,
            type: QueryTypes.SELECT,
            transaction
          }
        );
        totalItems = Number(countRows[0]?.total || 0);
        const totalFacts = Number(countRows[0]?.total_facts || 0);
        if (
          totalItems
          > MARKETING_AD_READ_CONTRACT.pagination.maximumExactRatioSortItems
          || totalFacts
          > MARKETING_AD_READ_CONTRACT.pagination.maximumExactRatioSortFacts
        ) {
          throw sortScopeTooLarge('精确比率排序范围过大，请缩小关键词筛选范围');
        }
        const boundedFacts = await this.sequelize.query(
          `SELECT ${exactFactColumns(
            KEYWORD_COLUMNS,
            ['campaign_name', 'ad_group_name', 'keyword_name', 'targeting_type']
          )}
           FROM baidu_keyword_daily_metrics WHERE ${where.sql}`,
          {
            replacements: where.replacements,
            type: QueryTypes.SELECT,
            transaction
          }
        );
        const exactAggregation = aggregateExactFacts(
          boundedFacts,
          KEYWORD_COLUMNS,
          ['campaign_name', 'ad_group_name', 'keyword_name', 'targeting_type']
        );
        exactAggregation.items.sort((left, right) => compareExactRatio(
          left,
          right,
          ratioNumerator,
          ratioDenominator,
          options,
          KEYWORD_COLUMNS
        ));
        items = exactAggregation.items.slice(
          replacements.offset,
          replacements.offset + options.pageSize
        );
        exactRatioSummary = exactAggregation.summary;
      } else {
        items = await this.sequelize.query(
          `SELECT * FROM (${aggregateSql}) aggregated_keywords
           ORDER BY ${stableKeywordOrder(options, dialect)}
           LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT, transaction }
        );
        const countRows = await this.sequelize.query(
          `SELECT COUNT(*) AS total
           FROM (
             SELECT 1
             FROM baidu_keyword_daily_metrics
             WHERE ${where.sql}
             GROUP BY ${KEYWORD_COLUMNS.join(', ')}
           ) grouped_keywords`,
          {
            replacements: where.replacements,
            type: QueryTypes.SELECT,
            transaction
          }
        );
        totalItems = Number(countRows[0]?.total || 0);
      }
      const summary = exactRatioSummary
        ? exactRatioSummary
        : dialect === 'postgres'
        ? exactSummary((await this.sequelize.query(
            postgresExactSummarySql('baidu_keyword_daily_metrics', where.sql),
            {
              replacements: where.replacements,
              type: QueryTypes.SELECT,
              transaction
            }
          ))[0])
        : await sqliteExactSummary({
            sequelize: this.sequelize,
            table: 'baidu_keyword_daily_metrics',
            where: where.sql,
            replacements: where.replacements,
            transaction
          });
      const itemKeys = new Set(items.map((item) => KEYWORD_COLUMNS
        .map((column) => item[column])
        .join('\u0000')));
      const pageIdentityWhere = buildPageIdentityWhere(items, KEYWORD_COLUMNS);
      const trendRows = itemKeys.size === 0
        ? []
        : await this.sequelize.query(
            `SELECT *
             FROM baidu_keyword_daily_metrics
             WHERE ${where.sql}
             AND ${pageIdentityWhere.sql}
             ORDER BY metric_date ASC`,
            {
              replacements: {
                ...where.replacements,
                ...pageIdentityWhere.replacements
              },
              type: QueryTypes.SELECT,
              transaction
            }
          );
      const trendByKey = new Map();
      for (const row of trendRows) {
        const key = KEYWORD_COLUMNS.map((column) => row[column]).join('\u0000');
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
      return {
        schemaVersion: MARKETING_AD_READ_CONTRACT.resources.keywords.schemaVersion,
        projectId: String(input.projectId),
        revision: selected.run.id,
        coverage: {
          from: selected.run.coverage_start,
          to: selected.run.coverage_end,
          lastSuccessfulAt: selected.run.finished_at,
          currency: selected.run.currency_code,
          costScale: Number(selected.run.cost_scale)
        },
        filter: keywordResponseFilter(options, selected),
        summary,
        items: items.map((item) => {
          const key = KEYWORD_COLUMNS.map((column) => item[column]).join('\u0000');
          return {
            accountId: item.external_account_id,
            campaignId: item.campaign_id,
            campaignName: item.campaign_name,
            adGroupId: item.ad_group_id,
            adGroupName: item.ad_group_name,
            keywordId: item.keyword_id,
            keywordName: item.keyword_name,
            targetingType: item.targeting_type,
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
      const ratioNumerator = options.sortBy === 'ctr'
        ? 'clicks'
        : 'cost_amount_scaled';
      const ratioDenominator = options.sortBy === 'ctr'
        ? 'impressions'
        : 'clicks';
      const sqliteRatioSort = dialect === 'sqlite'
        && ['ctr', 'averageCpc'].includes(options.sortBy);
      const replacements = {
        ...where.replacements,
        limit: options.pageSize,
        offset: (options.page - 1) * options.pageSize
      };
      let items;
      let totalItems;
      let exactRatioSummary = null;
      if (sqliteRatioSort) {
        const countRows = await this.sequelize.query(
          `SELECT COUNT(*) AS total, COALESCE(SUM(fact_count), 0) AS total_facts
           FROM (
             SELECT COUNT(*) AS fact_count
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
        totalItems = Number(countRows[0]?.total || 0);
        const totalFacts = Number(countRows[0]?.total_facts || 0);
        if (
          totalItems
          > MARKETING_AD_READ_CONTRACT.pagination.maximumExactRatioSortItems
          || totalFacts
          > MARKETING_AD_READ_CONTRACT.pagination.maximumExactRatioSortFacts
        ) {
          throw sortScopeTooLarge('精确比率排序范围过大，请缩小搜索词筛选范围');
        }
        const boundedFacts = await this.sequelize.query(
          `SELECT ${exactFactColumns(
            SEARCH_TERM_COLUMNS,
            [
              'campaign_name',
              'ad_group_name',
              'keyword_name',
              'search_term',
              'query_status',
              'match_type'
            ]
          )}
           FROM baidu_search_term_daily_metrics WHERE ${where.sql}`,
          {
            replacements: where.replacements,
            type: QueryTypes.SELECT,
            transaction
          }
        );
        const exactAggregation = aggregateExactFacts(
          boundedFacts,
          SEARCH_TERM_COLUMNS,
          [
            'campaign_name',
            'ad_group_name',
            'keyword_name',
            'search_term',
            'query_status',
            'match_type'
          ]
        );
        exactAggregation.items.sort((left, right) => compareExactRatio(
          left,
          right,
          ratioNumerator,
          ratioDenominator,
          options,
          SEARCH_TERM_COLUMNS
        ));
        items = exactAggregation.items.slice(
          replacements.offset,
          replacements.offset + options.pageSize
        );
        exactRatioSummary = exactAggregation.summary;
      } else {
        items = await this.sequelize.query(
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
        totalItems = Number(countRows[0]?.total || 0);
      }
      const summary = exactRatioSummary
        ? exactRatioSummary
        : dialect === 'postgres'
        ? exactSummary((await this.sequelize.query(
            postgresExactSummarySql('baidu_search_term_daily_metrics', where.sql),
            {
              replacements: where.replacements,
              type: QueryTypes.SELECT,
              transaction
            }
          ))[0])
        : await sqliteExactSummary({
            sequelize: this.sequelize,
            table: 'baidu_search_term_daily_metrics',
            where: where.sql,
            replacements: where.replacements,
            transaction
          });
      const itemKeys = new Set(items.map((item) => [
        item.external_account_id,
        item.campaign_id,
        item.ad_group_id,
        item.search_term_key
      ].join('\u0000')));
      const pageIdentityWhere = buildPageIdentityWhere(
        items,
        SEARCH_TERM_COLUMNS
      );
      const trendRows = itemKeys.size === 0
        ? []
        : await this.sequelize.query(
            `SELECT *
             FROM baidu_search_term_daily_metrics
             WHERE ${where.sql}
             AND ${pageIdentityWhere.sql}
             ORDER BY metric_date ASC`,
            {
              replacements: {
                ...where.replacements,
                ...pageIdentityWhere.replacements
              },
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
        summary,
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
