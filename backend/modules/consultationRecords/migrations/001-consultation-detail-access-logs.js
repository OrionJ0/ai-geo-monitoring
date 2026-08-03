const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.createTable('consultation_detail_access_logs', {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      project_id: { type: DataTypes.INTEGER, allowNull: false },
      action: { type: DataTypes.STRING(64), allowNull: false },
      source_system: { type: DataTypes.STRING(32), allowNull: false },
      consultation_type: { type: DataTypes.STRING(32), allowNull: false },
      record_fingerprint: { type: DataTypes.STRING(64), allowNull: false },
      viewed_at: { type: DataTypes.DATE, allowNull: false }
    }, { transaction });
    await queryInterface.addIndex(
      'consultation_detail_access_logs',
      ['project_id', 'viewed_at'],
      { name: 'consultation_detail_access_project_time', transaction }
    );
    await queryInterface.addIndex(
      'consultation_detail_access_logs',
      ['user_id', 'viewed_at'],
      { name: 'consultation_detail_access_user_time', transaction }
    );
  }
};
