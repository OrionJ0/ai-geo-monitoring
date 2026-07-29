const { DataTypes } = require('sequelize');

module.exports = {
  async up({ sequelize, queryInterface, transaction }) {
    await queryInterface.createTable('baidu_project_bindings', {
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
      connection_id: {
        type: DataTypes.STRING(36),
        allowNull: false,
        references: { model: 'baidu_marketing_connections', key: 'id' },
        onDelete: 'RESTRICT'
      },
      external_account_id: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      external_account_name: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false
      },
      binding_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      paused_reason: {
        type: DataTypes.STRING(80),
        allowNull: true
      },
      created_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false
      }
    }, {
      transaction,
      uniqueKeys: {
        baidu_project_bindings_scope_unique: {
          fields: ['project_id', 'connection_id', 'external_account_id']
        }
      }
    });

    await queryInterface.addIndex(
      'baidu_project_bindings',
      ['connection_id'],
      {
        name: 'baidu_project_bindings_connection',
        transaction
      }
    );
    await queryInterface.addIndex(
      'baidu_project_bindings',
      ['project_id', 'status'],
      {
        name: 'baidu_project_bindings_project_status',
        transaction
      }
    );
    await sequelize.query(
      `CREATE UNIQUE INDEX baidu_project_bindings_one_active_account
       ON baidu_project_bindings (connection_id, external_account_id)
       WHERE status = 'ACTIVE'`,
      { transaction }
    );
  }
};
