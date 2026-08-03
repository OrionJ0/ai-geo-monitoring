const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.addColumn(
      'baidu_project_bindings',
      'tongji_site_id',
      {
        type: DataTypes.TEXT,
        allowNull: true
      },
      { transaction }
    );
    await queryInterface.addColumn(
      'baidu_project_bindings',
      'tongji_site_domain',
      {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      { transaction }
    );
  }
};
