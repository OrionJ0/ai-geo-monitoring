function contractError() {
  const error = new Error('统一 OAuth 合同尚未满足，拒绝删除旧百度统计凭据列');
  error.code = 'MARKETING_LEGACY_TONGJI_CONTRACT_UNSAFE';
  return error;
}

function countValue(rows) {
  return Number(rows[0]?.unsafe_count || rows[0]?.unsafeCount || 0);
}

module.exports = {
  async up({ sequelize, transaction }) {
    const [unsafeBindings] = await sequelize.query(
      `SELECT COUNT(*) AS unsafe_count
       FROM baidu_project_bindings b
       JOIN baidu_marketing_connections c
         ON c.id = b.connection_id
       WHERE b.status = 'ACTIVE'
         AND (
           c.status <> 'CONNECTED'
           OR c.tongji_user_name IS NULL
           OR length(trim(c.tongji_user_name)) = 0
           OR c.tongji_user_name_verified_at IS NULL
           OR c.marketing_access_state <> 'VERIFIED'
           OR c.tongji_access_state <> 'VERIFIED'
           OR c.marketing_observed_auth_generation IS NULL
           OR c.marketing_observed_auth_generation <> c.auth_generation
           OR c.marketing_observed_token_version IS NULL
           OR c.marketing_observed_token_version <> c.token_version
           OR c.tongji_observed_auth_generation IS NULL
           OR c.tongji_observed_auth_generation <> c.auth_generation
           OR c.tongji_observed_token_version IS NULL
           OR c.tongji_observed_token_version <> c.token_version
           OR c.refresh_claim_token IS NOT NULL
           OR c.refresh_claim_until IS NOT NULL
         )`,
      { transaction }
    );
    const [inFlightReauthorizations] = await sequelize.query(
      `SELECT COUNT(*) AS unsafe_count
       FROM baidu_authorization_attempts
       WHERE operation = 'REAUTHORIZE'
         AND target_connection_id IS NOT NULL
         AND status IN ('PENDING', 'PROCESSING')`,
      { transaction }
    );
    if (
      countValue(unsafeBindings) > 0
      || countValue(inFlightReauthorizations) > 0
    ) {
      throw contractError();
    }

    for (const column of [
      'tongji_credential_updated_at',
      'tongji_access_token_ciphertext',
      'tongji_account_name'
    ]) {
      await sequelize.query(
        `ALTER TABLE baidu_marketing_connections DROP COLUMN ${column}`,
        { transaction }
      );
    }
  }
};
