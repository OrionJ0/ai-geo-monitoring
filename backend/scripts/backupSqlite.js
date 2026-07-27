const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function openReadonly(filename) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(
      filename,
      sqlite3.OPEN_READONLY,
      (error) => {
        if (error) reject(error);
        else resolve(database);
      }
    );
  });
}

async function copySnapshot(sourcePath, temporaryPath) {
  const source = await openReadonly(sourcePath);
  try {
    await new Promise((resolve, reject) => {
      const backup = source.backup(temporaryPath, (initializeError) => {
        if (initializeError) {
          reject(initializeError);
          return;
        }

        backup.step(-1, (stepError, completed) => {
          if (stepError || !completed) {
            backup.finish(() => {
              reject(stepError || new Error('SQLite 备份未完成'));
            });
            return;
          }

          backup.finish(resolve);
        });
      });
    });
  } finally {
    await closeDatabase(source);
  }
}

async function quickCheck(filename) {
  const database = await openReadonly(filename);
  try {
    return await new Promise((resolve, reject) => {
      database.get('PRAGMA quick_check', (error, row) => {
        if (error) reject(error);
        else resolve(row?.quick_check);
      });
    });
  } finally {
    await closeDatabase(database);
  }
}

async function removeTemporaryArtifacts(temporaryPath) {
  await Promise.all([
    temporaryPath,
    `${temporaryPath}-shm`,
    `${temporaryPath}-wal`,
  ].map((filename) => fs.promises.rm(filename, { force: true })));
}

async function backupDatabase({ sourcePath, backupPath }) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedBackup = path.resolve(backupPath);
  const temporaryPath = `${resolvedBackup}.tmp`;

  if (resolvedSource === resolvedBackup) {
    throw new Error('SQLite 源数据库与备份路径不能相同');
  }
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`SQLite 数据库不存在: ${resolvedSource}`);
  }

  await fs.promises.mkdir(path.dirname(resolvedBackup), { recursive: true });
  await removeTemporaryArtifacts(temporaryPath);

  try {
    await copySnapshot(resolvedSource, temporaryPath);
    const integrity = await quickCheck(temporaryPath);
    if (integrity !== 'ok') {
      throw new Error(`SQLite 备份完整性检查失败: ${integrity || 'unknown'}`);
    }
    await fs.promises.chmod(temporaryPath, 0o600);
    await fs.promises.rename(temporaryPath, resolvedBackup);
    await removeTemporaryArtifacts(temporaryPath);
    return { backupPath: resolvedBackup, integrity };
  } catch (error) {
    await removeTemporaryArtifacts(temporaryPath);
    throw error;
  }
}

async function main() {
  const [sourcePath, backupPath] = process.argv.slice(2);
  if (!sourcePath || !backupPath) {
    throw new Error('用法: node backend/scripts/backupSqlite.js <数据库路径> <备份路径>');
  }

  const result = await backupDatabase({ sourcePath, backupPath });
  console.log(`SQLite 最新备份已更新: ${result.backupPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  backupDatabase,
};
