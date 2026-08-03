const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.addColumn(
      'baidu_marketing_connections',
      'tongji_account_name',
      {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      { transaction }
    );
    await queryInterface.addColumn(
      'baidu_marketing_connections',
      'tongji_access_token_ciphertext',
      {
        type: DataTypes.TEXT,
        allowNull: true
      },
      { transaction }
    );
    await queryInterface.addColumn(
      'baidu_marketing_connections',
      'tongji_credential_updated_at',
      {
        type: DataTypes.DATE,
        allowNull: true
      },
      { transaction }
    );
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeColumn(
      'baidu_marketing_connections',
      'tongji_credential_updated_at',
      { transaction }
    );
    await queryInterface.removeColumn(
      'baidu_marketing_connections',
      'tongji_access_token_ciphertext',
      { transaction }
    );
    await queryInterface.removeColumn(
      'baidu_marketing_connections',
      'tongji_account_name',
      { transaction }
    );
  }
};
