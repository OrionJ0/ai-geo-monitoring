const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.createTable('baidu_tongji_snapshots', {
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
      device: {
        type: DataTypes.STRING(8),
        allowNull: false
      },
      site_id: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      site_domain: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      coverage_start: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      coverage_end: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      payload_json: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      refreshed_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false
      }
    }, { transaction });

    await queryInterface.addIndex(
      'baidu_tongji_snapshots',
      ['project_id', 'device'],
      {
        name: 'baidu_tongji_snapshots_project_device',
        unique: true,
        transaction
      }
    );
    await queryInterface.addIndex(
      'baidu_tongji_snapshots',
      ['expires_at'],
      {
        name: 'baidu_tongji_snapshots_expiry',
        transaction
      }
    );
  }
};
