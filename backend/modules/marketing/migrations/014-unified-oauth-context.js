const { DataTypes } = require('sequelize');

const PRODUCT_COLUMNS = Object.freeze([
  ['marketing_access_state', DataTypes.STRING(24), 'UNKNOWN'],
  ['marketing_observed_auth_generation', DataTypes.INTEGER, null],
  ['marketing_observed_token_version', DataTypes.INTEGER, null],
  ['marketing_checked_at', DataTypes.DATE, null],
  ['marketing_last_error_code', DataTypes.STRING(80), null],
  ['tongji_access_state', DataTypes.STRING(24), 'UNKNOWN'],
  ['tongji_observed_auth_generation', DataTypes.INTEGER, null],
  ['tongji_observed_token_version', DataTypes.INTEGER, null],
  ['tongji_checked_at', DataTypes.DATE, null],
  ['tongji_last_error_code', DataTypes.STRING(80), null]
]);

module.exports = {
  async up({ sequelize, queryInterface, transaction }) {
    await queryInterface.addColumn(
      'baidu_marketing_connections',
      'tongji_user_name',
      {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      { transaction }
    );
    await queryInterface.addColumn(
      'baidu_marketing_connections',
      'tongji_user_name_verified_at',
      {
        type: DataTypes.DATE,
        allowNull: true
      },
      { transaction }
    );
    for (const [name, type, defaultValue] of PRODUCT_COLUMNS) {
      await queryInterface.addColumn(
        'baidu_marketing_connections',
        name,
        {
          type,
          allowNull: defaultValue === null,
          ...(defaultValue === null ? {} : { defaultValue })
        },
        { transaction }
      );
    }
    await sequelize.query(
      `UPDATE baidu_marketing_connections
       SET tongji_user_name = tongji_account_name
       WHERE tongji_account_name IS NOT NULL
         AND length(trim(tongji_account_name)) > 0`,
      { transaction }
    );
  }
};
