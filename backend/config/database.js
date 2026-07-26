const { Sequelize } = require('sequelize');

const isDevelopment = process.env.NODE_ENV === 'development';
const enableSQLLogging = process.env.DB_LOGGING === 'true' || (isDevelopment && process.env.DB_LOGGING !== 'false');

const commonOptions = {
  logging: enableSQLLogging ? (sql) => {
    // 仅在超过阈值的慢查询时输出，避免日志洪流拖慢事件循环
    if (typeof sql === 'string' && sql.length > 500) {
      console.log(`[DB] ${sql.slice(0, 500)}...`);
    }
  } : false,
  define: {
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  pool: {
    max: 10,
    min: 2,
    acquire: 10000,
    idle: 10000,
  },
};

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      ...commonOptions,
      dialect: 'postgres',
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      }
    })
  : new Sequelize({
      ...commonOptions,
      dialect: 'sqlite',
      storage: process.env.DB_STORAGE || 'database.sqlite',
      // SQLite 限制连接数，但 WAL 模式下支持并发读
      pool: {
        max: 5,
        min: 1,
        acquire: 10000,
        idle: 10000,
      },
    });

const databaseReadiness = {
  status: 'initializing',
  dialect: sequelize.getDialect(),
  last_error_code: null
};

sequelize.getReadiness = () => ({ ...databaseReadiness });

function runSqliteStatement(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.run(sql, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readSqlitePragma(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.get(sql, (error, row) => {
      if (error) reject(error);
      else resolve(row || {});
    });
  });
}

// SQLite WAL 模式：允许读写并发，大幅减少页面切换时的文件锁等待
if (sequelize.getDialect() === 'sqlite') {
  const configuredConnections = new WeakSet();
  const getConnection = sequelize.connectionManager.getConnection.bind(sequelize.connectionManager);
  sequelize.connectionManager.getConnection = async (...args) => {
    const connection = await getConnection(...args);
    if (!configuredConnections.has(connection)) {
      try {
        const inMemory = connection.filename === ':memory:';
        if (!inMemory) {
          await runSqliteStatement(connection, 'PRAGMA journal_mode=WAL;');
        }
        await runSqliteStatement(connection, 'PRAGMA busy_timeout=5000;');
        await runSqliteStatement(connection, 'PRAGMA synchronous=NORMAL;');
        const journal = await readSqlitePragma(connection, 'PRAGMA journal_mode;');
        const timeout = await readSqlitePragma(connection, 'PRAGMA busy_timeout;');
        const synchronous = await readSqlitePragma(connection, 'PRAGMA synchronous;');
        const journalMode = String(journal.journal_mode || '').toLowerCase();
        const busyTimeout = Number(timeout.timeout);
        const synchronousValue = Number(synchronous.synchronous);
        const expectedJournalMode = inMemory ? 'memory' : 'wal';
        if (journalMode !== expectedJournalMode || busyTimeout < 5000 || synchronousValue !== 1) {
          const error = new Error('SQLite 并发配置未生效');
          error.code = 'SQLITE_PRAGMA_VERIFICATION_FAILED';
          throw error;
        }
        configuredConnections.add(connection);
        Object.assign(databaseReadiness, {
          status: 'ready',
          journal_mode: journalMode,
          busy_timeout_ms: busyTimeout,
          synchronous: 'normal',
          last_error_code: null
        });
      } catch (error) {
        databaseReadiness.status = 'error';
        databaseReadiness.last_error_code = error?.code || 'sqlite_configuration_failed';
        throw error;
      }
    }
    return connection;
  };
} else {
  sequelize.afterConnect(() => {
    databaseReadiness.status = 'ready';
    databaseReadiness.last_error_code = null;
  });
}

module.exports = sequelize;
