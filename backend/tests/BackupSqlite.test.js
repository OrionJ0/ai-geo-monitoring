const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite3 = require('sqlite3');

const { backupDatabase } = require('../scripts/backupSqlite');

function openDatabase(filename) {
  return new sqlite3.Database(filename);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function get(db, sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test('creates one verified latest snapshot while the WAL source remains open', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-backup-'));
  const sourcePath = path.join(directory, 'database.sqlite');
  const backupPath = path.join(directory, 'database.latest.sqlite');
  const source = openDatabase(sourcePath);

  t.after(async () => {
    await close(source);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await run(source, 'PRAGMA journal_mode=WAL');
  await run(source, 'PRAGMA wal_autocheckpoint=0');
  await run(source, 'CREATE TABLE deployment_check (value TEXT NOT NULL)');
  await run(source, 'INSERT INTO deployment_check (value) VALUES (?)', ['latest']);
  fs.writeFileSync(backupPath, 'previous backup');

  const result = await backupDatabase({ sourcePath, backupPath });

  assert.equal(result.backupPath, backupPath);
  assert.equal(result.integrity, 'ok');
  assert.equal(fs.existsSync(`${backupPath}.tmp`), false);
  assert.equal(fs.existsSync(`${backupPath}.tmp-shm`), false);
  assert.equal(fs.existsSync(`${backupPath}.tmp-wal`), false);

  const backup = openDatabase(backupPath);
  t.after(() => close(backup));
  assert.deepEqual(
    await get(backup, 'SELECT value FROM deployment_check'),
    { value: 'latest' }
  );
  assert.deepEqual(await get(backup, 'PRAGMA quick_check'), { quick_check: 'ok' });
});
