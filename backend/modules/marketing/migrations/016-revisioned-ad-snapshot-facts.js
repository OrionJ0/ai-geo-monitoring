const { QueryTypes } = require('sequelize');

const FACT_CONSTRAINTS = [
  {
    table: 'baidu_campaign_daily_metrics',
    name: 'baidu_campaign_daily_metrics_fact_unique',
    fields: ['refresh_run_id', 'binding_id', 'campaign_id', 'metric_date']
  },
  {
    table: 'baidu_ad_group_daily_metrics',
    name: 'baidu_ad_group_daily_metrics_fact_unique',
    fields: [
      'refresh_run_id',
      'binding_id',
      'campaign_id',
      'ad_group_id',
      'metric_date'
    ]
  },
  {
    table: 'baidu_keyword_daily_metrics',
    name: 'baidu_keyword_daily_metrics_fact_unique',
    fields: [
      'refresh_run_id',
      'binding_id',
      'campaign_id',
      'ad_group_id',
      'keyword_id',
      'metric_date'
    ]
  },
  {
    table: 'baidu_search_term_daily_metrics',
    name: 'baidu_search_term_daily_metrics_fact_unique',
    fields: [
      'refresh_run_id',
      'binding_id',
      'search_term_key',
      'metric_date'
    ]
  }
];

function quote(identifier) {
  return `"${identifier}"`;
}

async function rebuildSqliteTable({ sequelize, transaction, definition }) {
  const rows = await sequelize.query(
    `SELECT sql FROM sqlite_master
     WHERE type = 'table' AND name = :table`,
    {
      replacements: { table: definition.table },
      type: QueryTypes.SELECT,
      transaction
    }
  );
  const definitions = Array.isArray(rows[0]) ? rows[0] : rows;
  const originalSql = definitions[0]?.sql;
  if (typeof originalSql !== 'string') {
    throw new Error(`无法读取营销事实表结构：${definition.table}`);
  }
  const temporaryTable = `${definition.table}__revisioned`;
  const tablePattern = new RegExp(
    `^CREATE TABLE\\s+(?:${definition.table}|"${definition.table}"|\`${definition.table}\`)`,
    'iu'
  );
  const constraintPattern = new RegExp(
    `CONSTRAINT\\s+${definition.name}\\s+UNIQUE\\s*\\([^)]*\\)`,
    'iu'
  );
  const revisedSql = originalSql
    .replace(tablePattern, `CREATE TABLE ${temporaryTable}`)
    .replace(
      constraintPattern,
      `CONSTRAINT ${definition.name} UNIQUE (${definition.fields.join(', ')})`
    );
  if (
    revisedSql === originalSql
    || !revisedSql.startsWith(`CREATE TABLE ${temporaryTable}`)
  ) {
    throw new Error(`无法改写营销事实唯一约束：${definition.table}`);
  }
  const columns = await sequelize.query(
    `PRAGMA table_info(${quote(definition.table)})`,
    { transaction }
  );
  const columnRows = Array.isArray(columns[0]) ? columns[0] : columns;
  const columnList = columnRows.map((column) => quote(column.name)).join(', ');
  if (!columnList) throw new Error(`营销事实表没有列：${definition.table}`);

  const counts = await sequelize.query(
    `SELECT COUNT(*) AS count FROM ${quote(definition.table)}`,
    { type: QueryTypes.SELECT, transaction }
  );

  await sequelize.query(revisedSql, { transaction });
  if (Number(counts[0]?.count || 0) > 0) {
    await sequelize.query(
      `INSERT INTO ${quote(temporaryTable)} (${columnList})
       SELECT ${columnList} FROM ${quote(definition.table)}`,
      { transaction }
    );
  }
  await sequelize.query(`DROP TABLE ${quote(definition.table)}`, { transaction });
  await sequelize.query(
    `ALTER TABLE ${quote(temporaryTable)} RENAME TO ${quote(definition.table)}`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX ${quote(`${definition.table}_run`)}
     ON ${quote(definition.table)} (refresh_run_id)`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX ${quote(`${definition.table}_project_date`)}
     ON ${quote(definition.table)} (project_id, metric_date)`,
    { transaction }
  );
}

module.exports = {
  async up({ sequelize, transaction }) {
    await sequelize.query(
      `ALTER TABLE baidu_marketing_refresh_runs
       ADD COLUMN snapshot_facts_retained BOOLEAN NOT NULL DEFAULT TRUE`,
      { transaction }
    );
    await sequelize.query(
      `UPDATE baidu_marketing_refresh_runs
       SET snapshot_facts_retained = FALSE
       WHERE status = 'SUCCEEDED'`,
      { transaction }
    );
    await sequelize.query(
      `UPDATE baidu_marketing_refresh_runs
       SET snapshot_facts_retained = TRUE
       WHERE id IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY project_id
                    ORDER BY project_run_sequence DESC
                  ) AS retention_rank
           FROM baidu_marketing_refresh_runs
           WHERE status = 'SUCCEEDED'
         ) AS ranked_runs
         WHERE retention_rank = 1
       )`,
      { transaction }
    );
    for (const definition of FACT_CONSTRAINTS) {
      if (sequelize.getDialect() === 'sqlite') {
        await rebuildSqliteTable({ sequelize, transaction, definition });
        continue;
      }
      await sequelize.query(
        `ALTER TABLE ${quote(definition.table)}
         DROP CONSTRAINT ${quote(definition.name)}`,
        { transaction }
      );
      await sequelize.query(
        `ALTER TABLE ${quote(definition.table)}
         ADD CONSTRAINT ${quote(definition.name)}
         UNIQUE (${definition.fields.map(quote).join(', ')})`,
        { transaction }
      );
    }
  }
};
