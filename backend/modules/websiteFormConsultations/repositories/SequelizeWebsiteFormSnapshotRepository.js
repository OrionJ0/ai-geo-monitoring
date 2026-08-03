const crypto = require('node:crypto');
const { QueryTypes } = require('sequelize');

class SequelizeWebsiteFormSnapshotRepository {
  constructor({ sequelize }) {
    if (!sequelize || typeof sequelize.query !== 'function') {
      throw new TypeError('官网表单快照仓储缺少数据库连接');
    }
    this.sequelize = sequelize;
  }

  async read({ projectId, payloadKind, schemaVersion, coverage }) {
    const rows = await this.sequelize.query(
      `SELECT project_id, payload_kind, schema_version,
              coverage_start, coverage_end, payload_json,
              refreshed_at, expires_at
       FROM website_form_consultation_snapshots_v2
       WHERE project_id = :projectId
         AND payload_kind = :payloadKind
         AND schema_version = :schemaVersion
         AND coverage_start = :coverageStart
         AND coverage_end = :coverageEnd
       LIMIT 1`,
      {
        replacements: {
          projectId,
          payloadKind,
          schemaVersion,
          coverageStart: coverage.from,
          coverageEnd: coverage.to
        },
        type: QueryTypes.SELECT
      }
    );
    const row = rows[0];
    if (!row) return null;
    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      return null;
    }
    return {
      projectId: String(row.project_id),
      payloadKind: String(row.payload_kind),
      schemaVersion: String(row.schema_version),
      coverage: {
        from: String(row.coverage_start),
        to: String(row.coverage_end),
        timeZone: 'Asia/Shanghai'
      },
      payload,
      refreshedAt: new Date(row.refreshed_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString()
    };
  }

  async save(snapshot) {
    const now = new Date().toISOString();
    const replacements = {
      projectId: snapshot.projectId,
      payloadKind: snapshot.payloadKind,
      schemaVersion: snapshot.schemaVersion,
      coverageStart: snapshot.coverage.from,
      coverageEnd: snapshot.coverage.to,
      payloadJson: JSON.stringify(snapshot.payload),
      refreshedAt: snapshot.refreshedAt,
      expiresAt: snapshot.expiresAt,
      staleCutoff: snapshot.staleCutoff || null,
      updatedAt: now
    };
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query(
        `INSERT INTO website_form_consultation_snapshots_v2 (
           id, project_id, payload_kind, schema_version,
           coverage_start, coverage_end, payload_json,
           refreshed_at, expires_at, created_at, updated_at
         ) VALUES (
           :id, :projectId, :payloadKind, :schemaVersion,
           :coverageStart, :coverageEnd, :payloadJson,
           :refreshedAt, :expiresAt, :createdAt, :updatedAt
         )
         ON CONFLICT (
           project_id, payload_kind, schema_version, coverage_start, coverage_end
         ) DO UPDATE SET
           payload_json = excluded.payload_json,
           refreshed_at = excluded.refreshed_at,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at
         WHERE excluded.refreshed_at >=
           website_form_consultation_snapshots_v2.refreshed_at`,
        {
          replacements: {
            ...replacements,
            id: crypto.randomUUID(),
            createdAt: now
          },
          transaction
        }
      );
      if (replacements.staleCutoff) {
        await this.sequelize.query(
          `DELETE FROM website_form_consultation_snapshots_v2
           WHERE refreshed_at < :staleCutoff`,
          {
            replacements,
            transaction
          }
        );
      }
    });
  }
}

module.exports = {
  SequelizeWebsiteFormSnapshotRepository
};
