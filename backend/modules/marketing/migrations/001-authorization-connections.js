const { DataTypes } = require('sequelize');

module.exports = {
  async up({ queryInterface, transaction }) {
    await queryInterface.createTable('baidu_marketing_connections', {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      status: {
        type: DataTypes.STRING(24),
        allowNull: false
      },
      authorized_principal_id: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      authorized_principal_name: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      access_token_ciphertext: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      refresh_token_ciphertext: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      access_token_expires_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      auth_generation: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      token_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      refresh_claim_token: {
        type: DataTypes.STRING(64),
        allowNull: true
      },
      refresh_claim_until: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT'
      },
      last_error_code: {
        type: DataTypes.STRING(80),
        allowNull: true
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
      'baidu_marketing_connections',
      ['created_by_user_id'],
      {
        name: 'baidu_marketing_connections_created_by',
        transaction
      }
    );

    await queryInterface.createTable('baidu_authorization_attempts', {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      launch_ticket_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true
      },
      provider_state_hash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true
      },
      result_ticket_hash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true
      },
      operation: {
        type: DataTypes.STRING(24),
        allowNull: false
      },
      initiated_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT'
      },
      target_connection_id: {
        type: DataTypes.STRING(36),
        allowNull: true,
        references: { model: 'baidu_marketing_connections', key: 'id' },
        onDelete: 'SET NULL'
      },
      expected_auth_generation: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      status: {
        type: DataTypes.STRING(24),
        allowNull: false
      },
      launch_consumed_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      result_consumed_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      failure_code: {
        type: DataTypes.STRING(80),
        allowNull: true
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
      'baidu_authorization_attempts',
      ['initiated_by_user_id', 'created_at'],
      {
        name: 'baidu_authorization_attempts_admin_created',
        transaction
      }
    );
  }
};
