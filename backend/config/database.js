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

// SQLite WAL 模式：允许读写并发，大幅减少页面切换时的文件锁等待
if (sequelize.getDialect() === 'sqlite') {
  sequelize.afterConnect(async (connection) => {
    try {
      await connection.run('PRAGMA journal_mode=WAL;');
      await connection.run('PRAGMA busy_timeout=5000;');
      await connection.run('PRAGMA synchronous=NORMAL;');
    } catch (_) {
      // 静默忽略 PRAGMA 错误
    }
  });
}

module.exports = sequelize;
