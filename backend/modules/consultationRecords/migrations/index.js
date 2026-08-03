const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_FILENAME = /^\d{3}-[a-z0-9-]+\.js$/u;

function loadConsultationRecordMigrations({ directory = __dirname } = {}) {
  return fs.readdirSync(directory)
    .filter((filename) => MIGRATION_FILENAME.test(filename))
    .sort()
    .map((filename) => {
      const absolutePath = path.join(directory, filename);
      const source = fs.readFileSync(absolutePath, 'utf8');
      const resolvedPath = require.resolve(absolutePath);
      delete require.cache[resolvedPath];
      const migration = require(resolvedPath);
      if (typeof migration?.up !== 'function') {
        const error = new Error(`咨询记录迁移缺少 up(): ${filename}`);
        error.code = 'CONSULTATION_RECORD_MIGRATION_INVALID';
        throw error;
      }
      return Object.freeze({
        version: filename.replace(/\.js$/u, ''),
        checksum: crypto.createHash('sha256').update(source).digest('hex'),
        up: migration.up
      });
    });
}

module.exports = { loadConsultationRecordMigrations };
