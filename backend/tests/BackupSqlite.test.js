const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite3 = require('sqlite3');

const {
  backupDatabase,
  verifyBackupManifest
} = require('../scripts/backupSqlite');

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

test('reuses a verified immutable release snapshot without overwriting it', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-release-backup-'));
  const sourcePath = path.join(directory, 'database.sqlite');
  const backupPath = path.join(directory, 'database.pre-release.sqlite');
  const source = openDatabase(sourcePath);

  t.after(async () => {
    await close(source);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await run(source, 'CREATE TABLE deployment_check (value TEXT NOT NULL)');
  await run(source, 'INSERT INTO deployment_check (value) VALUES (?)', ['before']);
  const first = await backupDatabase({ sourcePath, backupPath, ifAbsent: true });
  await run(source, 'UPDATE deployment_check SET value = ?', ['after']);
  const second = await backupDatabase({ sourcePath, backupPath, ifAbsent: true });

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600);
  const backup = openDatabase(backupPath);
  t.after(() => close(backup));
  assert.deepEqual(
    await get(backup, 'SELECT value FROM deployment_check'),
    { value: 'before' }
  );
  assert.deepEqual(await get(backup, 'PRAGMA quick_check'), { quick_check: 'ok' });
});

test('release manifest binds the complete backup to source identity and revision', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-release-manifest-'));
  const sourcePath = path.join(directory, 'database.sqlite');
  const otherPath = path.join(directory, 'other.sqlite');
  const backupPath = path.join(directory, 'database.pre-release.sqlite');
  const manifestPath = `${backupPath}.manifest.json`;
  const revision = 'b'.repeat(40);
  const source = openDatabase(sourcePath);
  const other = openDatabase(otherPath);

  t.after(async () => {
    await close(source);
    await close(other);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  for (const database of [source, other]) {
    await run(database, 'CREATE TABLE question_records (id INTEGER PRIMARY KEY, question TEXT)');
    await run(database, "INSERT INTO question_records (id, question) VALUES (1, 'same')");
    await run(database, 'CREATE TABLE business_data (value TEXT NOT NULL)');
  }
  await run(source, "INSERT INTO business_data (value) VALUES ('source')");
  await run(other, "INSERT INTO business_data (value) VALUES ('other')");

  const result = await backupDatabase({
    sourcePath,
    backupPath,
    ifAbsent: true,
    manifestPath,
    revision
  });
  assert.equal(result.manifestPath, manifestPath);
  assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);

  await assert.rejects(
    backupDatabase({
      sourcePath: otherPath,
      backupPath,
      ifAbsent: true,
      manifestPath,
      revision
    }),
    /manifest 与源库、备份或 revision 不匹配/u
  );
  await assert.rejects(
    backupDatabase({
      sourcePath,
      backupPath,
      ifAbsent: true,
      manifestPath,
      revision: 'c'.repeat(40)
    }),
    /manifest 与源库、备份或 revision 不匹配/u
  );
});

test('manifest mode never overwrites an existing backup or accepts non-exclusive creation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-manifest-exclusive-'));
  const sourcePath = path.join(directory, 'database.sqlite');
  const backupPath = path.join(directory, 'database.pre-release.sqlite');
  const manifestPath = `${backupPath}.manifest.json`;
  const revision = 'd'.repeat(40);
  const source = openDatabase(sourcePath);

  t.after(async () => {
    await close(source);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await run(source, 'CREATE TABLE question_records (id INTEGER PRIMARY KEY)');

  await assert.rejects(
    backupDatabase({ sourcePath, backupPath, manifestPath, revision }),
    /--if-absent 不可覆盖模式/u
  );
  await backupDatabase({
    sourcePath,
    backupPath,
    ifAbsent: true,
    manifestPath,
    revision
  });
  const beforeBackup = fs.readFileSync(backupPath);
  const beforeManifest = fs.readFileSync(manifestPath);
  await run(source, 'ALTER TABLE question_records ADD COLUMN changed_after_backup TEXT');

  const reused = await backupDatabase({
    sourcePath,
    backupPath,
    ifAbsent: true,
    manifestPath,
    revision
  });
  assert.equal(reused.reused, true);
  assert.deepEqual(fs.readFileSync(backupPath), beforeBackup);
  assert.deepEqual(fs.readFileSync(manifestPath), beforeManifest);
});

test('concurrent manifest backups use isolated temporary files and publish one source', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-manifest-race-'));
  const sources = [
    path.join(directory, 'source-a.sqlite'),
    path.join(directory, 'source-b.sqlite')
  ];
  const backupPath = path.join(directory, 'database.pre-release.sqlite');
  const manifestPath = `${backupPath}.manifest.json`;
  const revision = 'e'.repeat(40);

  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [index, sourcePath] of sources.entries()) {
    const source = openDatabase(sourcePath);
    await run(source, 'CREATE TABLE question_records (id INTEGER PRIMARY KEY, marker TEXT)');
    await run(source, 'INSERT INTO question_records (id, marker) VALUES (1, ?)', [`source-${index}`]);
    await close(source);
  }

  const attempts = await Promise.allSettled(sources.map((sourcePath) => (
    backupDatabase({
      sourcePath,
      backupPath,
      ifAbsent: true,
      manifestPath,
      revision
    })
  )));
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  const winnerIndex = attempts.findIndex((result) => result.status === 'fulfilled');
  await verifyBackupManifest({
    sourcePath: sources[winnerIndex],
    backupPath,
    manifestPath,
    revision
  });
  const temporaryArtifacts = fs.readdirSync(directory)
    .filter((name) => name.includes('.tmp.'));
  assert.deepEqual(temporaryArtifacts, []);
});
