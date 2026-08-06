const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
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

async function fileSha256(filename) {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filename);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function databaseFileIdentity(sourcePath) {
  const identity = {};
  for (const suffix of ['', '-wal']) {
    const filename = `${sourcePath}${suffix}`;
    try {
      const stat = await fs.promises.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`SQLite 源文件无效: ${filename}`);
      }
      identity[suffix || 'main'] = {
        dev: String(stat.dev),
        ino: String(stat.ino),
        size: stat.size,
        mtime_ms: stat.mtimeMs
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      identity[suffix || 'main'] = null;
    }
  }
  return identity;
}

async function writeBackupManifest({
  sourcePath,
  backupPath,
  manifestPath,
  revision
}) {
  if (!/^[a-f0-9]{40}$/u.test(String(revision || '').trim())) {
    throw new Error('SQLite 备份 manifest 要求完整的 40 位 revision');
  }
  const resolvedManifest = path.resolve(manifestPath);
  if (fs.existsSync(resolvedManifest) || fs.lstatSync(path.dirname(resolvedManifest)).isSymbolicLink()) {
    throw new Error(`SQLite 备份 manifest 已存在或目录无效: ${resolvedManifest}`);
  }
  const sourceRealpath = await fs.promises.realpath(sourcePath);
  const backupRealpath = await fs.promises.realpath(backupPath);
  const manifest = {
    schema_version: 1,
    revision: String(revision).trim(),
    source_realpath: sourceRealpath,
    source_identity: await databaseFileIdentity(sourceRealpath),
    backup_realpath: backupRealpath,
    backup_sha256: await fileSha256(backupRealpath)
  };
  await fs.promises.writeFile(
    resolvedManifest,
    `${JSON.stringify(manifest)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' }
  );
  return resolvedManifest;
}

async function verifyBackupManifest({
  sourcePath,
  backupPath,
  manifestPath,
  revision,
  requireCurrentSourceState = true
}) {
  const resolvedManifest = await fs.promises.realpath(manifestPath);
  const stat = await fs.promises.lstat(resolvedManifest);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('SQLite 备份 manifest 不是普通文件');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('SQLite 备份 manifest 权限必须为 0600 或更严格');
  }
  const manifest = JSON.parse(await fs.promises.readFile(resolvedManifest, 'utf8'));
  const sourceRealpath = await fs.promises.realpath(sourcePath);
  const backupRealpath = await fs.promises.realpath(backupPath);
  const currentSourceIdentity = await databaseFileIdentity(sourceRealpath);
  const manifestMainIdentity = manifest.source_identity?.main;
  const currentMainIdentity = currentSourceIdentity.main;
  const sameSourceFile = (
    manifestMainIdentity
    && currentMainIdentity
    && manifestMainIdentity.dev === currentMainIdentity.dev
    && manifestMainIdentity.ino === currentMainIdentity.ino
  );
  if (
    manifest.schema_version !== 1
    || manifest.revision !== revision
    || manifest.source_realpath !== sourceRealpath
    || manifest.backup_realpath !== backupRealpath
    || manifest.backup_sha256 !== await fileSha256(backupRealpath)
    || !sameSourceFile
    || (
      requireCurrentSourceState
      && JSON.stringify(manifest.source_identity) !== JSON.stringify(
        currentSourceIdentity
      )
    )
  ) {
    throw new Error('SQLite 备份 manifest 与源库、备份或 revision 不匹配');
  }
  return resolvedManifest;
}

async function verifyExistingBackup(filename) {
  const stat = await fs.promises.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`SQLite release 备份不是普通文件: ${filename}`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`SQLite release 备份权限必须为 0600 或更严格: ${filename}`);
  }
  const integrity = await quickCheck(filename);
  if (integrity !== 'ok') {
    throw new Error(`SQLite release 备份完整性检查失败: ${integrity || 'unknown'}`);
  }
  return integrity;
}

async function backupDatabase({
  sourcePath,
  backupPath,
  ifAbsent = false,
  manifestPath = '',
  revision = ''
}) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedBackup = path.resolve(backupPath);
  const temporaryPath = `${resolvedBackup}.tmp.${process.pid}.${randomUUID()}`;

  if (manifestPath && !ifAbsent) {
    throw new Error('SQLite manifest 备份必须使用 --if-absent 不可覆盖模式');
  }

  if (resolvedSource === resolvedBackup) {
    throw new Error('SQLite 源数据库与备份路径不能相同');
  }
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`SQLite 数据库不存在: ${resolvedSource}`);
  }

  if (ifAbsent && fs.existsSync(resolvedBackup)) {
    const integrity = await verifyExistingBackup(resolvedBackup);
    const verifiedManifest = manifestPath
      ? await verifyBackupManifest({
          sourcePath: resolvedSource,
          backupPath: resolvedBackup,
          manifestPath,
          revision,
          requireCurrentSourceState: false
        })
      : '';
    return {
      backupPath: resolvedBackup,
      manifestPath: verifiedManifest,
      integrity,
      reused: true
    };
  }

  await fs.promises.mkdir(path.dirname(resolvedBackup), { recursive: true });
  await removeTemporaryArtifacts(temporaryPath);
  let backupPromoted = false;
  let promotedIdentity = null;

  try {
    await copySnapshot(resolvedSource, temporaryPath);
    const integrity = await quickCheck(temporaryPath);
    if (integrity !== 'ok') {
      throw new Error(`SQLite 备份完整性检查失败: ${integrity || 'unknown'}`);
    }
    await fs.promises.chmod(temporaryPath, 0o600);
    if (manifestPath) {
      const temporaryIdentity = await fs.promises.lstat(temporaryPath);
      await fs.promises.link(temporaryPath, resolvedBackup);
      promotedIdentity = await fs.promises.lstat(resolvedBackup);
      if (
        temporaryIdentity.dev !== promotedIdentity.dev
        || temporaryIdentity.ino !== promotedIdentity.ino
      ) {
        throw new Error('SQLite 备份排他发布 inode 校验失败');
      }
      await fs.promises.rm(temporaryPath, { force: true });
    } else {
      await fs.promises.rename(temporaryPath, resolvedBackup);
    }
    backupPromoted = true;
    await removeTemporaryArtifacts(temporaryPath);
    const createdManifest = manifestPath
      ? await writeBackupManifest({
          sourcePath: resolvedSource,
          backupPath: resolvedBackup,
          manifestPath,
          revision
        })
      : '';
    return {
      backupPath: resolvedBackup,
      manifestPath: createdManifest,
      integrity,
      reused: false
    };
  } catch (error) {
    await removeTemporaryArtifacts(temporaryPath);
    if (backupPromoted && manifestPath) {
      const current = await fs.promises.lstat(resolvedBackup).catch(() => null);
      if (
        current
        && promotedIdentity
        && current.dev === promotedIdentity.dev
        && current.ino === promotedIdentity.ino
      ) {
        await fs.promises.rm(resolvedBackup, { force: true });
      }
    }
    throw error;
  }
}

async function main() {
  const [sourcePath, backupPath, ...options] = process.argv.slice(2);
  if (!sourcePath || !backupPath) {
    throw new Error('用法: node backend/scripts/backupSqlite.js <数据库路径> <备份路径>');
  }

  const ifAbsent = options.includes('--if-absent');
  const manifestPath = options
    .find((value) => value.startsWith('--manifest='))
    ?.slice('--manifest='.length) || '';
  const revision = options
    .find((value) => value.startsWith('--revision='))
    ?.slice('--revision='.length) || '';
  const result = await backupDatabase({
    sourcePath,
    backupPath,
    ifAbsent,
    manifestPath,
    revision
  });
  console.log(result.reused
    ? `SQLite release 备份已验证并复用: ${result.backupPath}`
    : `SQLite 备份已创建: ${result.backupPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  backupDatabase,
  databaseFileIdentity,
  fileSha256,
  verifyBackupManifest,
};
