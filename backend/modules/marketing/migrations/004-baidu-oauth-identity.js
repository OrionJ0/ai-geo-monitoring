const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.addColumn(
      'baidu_marketing_connections',
      'authorized_open_id',
      {
        type: DataTypes.TEXT,
        allowNull: true
      },
      { transaction }
    );
    await queryInterface.addColumn(
      'baidu_marketing_connections',
      'refresh_token_expires_at',
      {
        type: DataTypes.DATE,
        allowNull: true
      },
      { transaction }
    );
  }
};
