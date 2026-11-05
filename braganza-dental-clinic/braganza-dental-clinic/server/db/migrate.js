'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS = [
  {
    version: 1,
    up: function (db) {
      const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      db.exec(sql);
    }
  }
];

async function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const applied = db.all('SELECT version FROM schema_migrations').map(function (row) { return row.version; });
  const pending = MIGRATIONS.filter(function (m) { return applied.indexOf(m.version) === -1; });
  if (!pending.length) {
    await db.persist();
    return [];
  }
  db.transaction(function () {
    pending.forEach(function (migration) {
      migration.up(db);
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        migration.version,
        new Date().toISOString()
      ]);
    });
  });
  await db.persist();
  return pending.map(function (m) { return m.version; });
}

module.exports = { migrate: migrate, MIGRATIONS: MIGRATIONS };
