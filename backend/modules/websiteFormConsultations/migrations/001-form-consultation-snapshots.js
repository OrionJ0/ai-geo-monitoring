const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.createTable('website_form_consultation_snapshots', {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'brand_projects', key: 'id' },
        onDelete: 'CASCADE'
      },
      coverage_start: { type: DataTypes.DATEONLY, allowNull: false },
      coverage_end: { type: DataTypes.DATEONLY, allowNull: false },
      payload_json: { type: DataTypes.TEXT, allowNull: false },
      refreshed_at: { type: DataTypes.DATE, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    }, { transaction });
    await queryInterface.addIndex(
      'website_form_consultation_snapshots',
      ['expires_at'],
      {
        name: 'website_form_consultation_snapshots_expiry',
        transaction
      }
    );
  }
};
