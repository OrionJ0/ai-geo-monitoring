const sqlite3 = require('sqlite3');

const originalRun = sqlite3.Database.prototype.run;
sqlite3.Database.prototype.run = function runWithForcedPragmaFailure(sql, ...args) {
  if (/PRAGMA journal_mode=WAL/i.test(String(sql))) {
    const callback = args.findLast((value) => typeof value === 'function');
    process.nextTick(() => callback?.call(this, new Error('forced sqlite pragma failure')));
    return this;
  }
  return originalRun.call(this, sql, ...args);
};
