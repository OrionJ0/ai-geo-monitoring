const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.createTable('website_form_consultation_snapshots_v2', {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'brand_projects', key: 'id' },
        onDelete: 'CASCADE'
      },
      payload_kind: { type: DataTypes.STRING(16), allowNull: false },
      schema_version: { type: DataTypes.STRING(64), allowNull: false },
      coverage_start: { type: DataTypes.DATEONLY, allowNull: false },
      coverage_end: { type: DataTypes.DATEONLY, allowNull: false },
      payload_json: { type: DataTypes.TEXT, allowNull: false },
      refreshed_at: { type: DataTypes.DATE, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    }, { transaction });
    await queryInterface.addIndex(
      'website_form_consultation_snapshots_v2',
      [
        'project_id',
        'payload_kind',
        'schema_version',
        'coverage_start',
        'coverage_end'
      ],
      {
        unique: true,
        name: 'website_form_consultation_snapshots_v2_identity',
        transaction
      }
    );
    await queryInterface.addIndex(
      'website_form_consultation_snapshots_v2',
      ['expires_at'],
      {
        name: 'website_form_consultation_snapshots_v2_expiry',
        transaction
      }
    );
  }
};
