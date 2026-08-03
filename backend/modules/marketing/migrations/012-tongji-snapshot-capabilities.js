const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    for (const table of [
      'baidu_tongji_snapshots',
      'baidu_tongji_range_snapshots'
    ]) {
      await queryInterface.addColumn(table, 'quality_included', {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      }, { transaction });
      await queryInterface.addColumn(table, 'sources_included', {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      }, { transaction });
    }
  }
};
