'use strict';

class SettingsRepository {
  constructor(db) {
    this.db = db;
  }

  all() {
    const out = {};
    this.db.all('SELECT key, value FROM settings').forEach(function (row) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch (error) {
        void error;
        out[row.key] = row.value;
      }
    });
    return out;
  }

  get(key) {
    const row = this.db.get('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch (error) {
      void error;
      return row.value;
    }
  }

  set(key, value, timestamp) {
    const now = timestamp || new Date().toISOString();
    this.db.run(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [key, JSON.stringify(value === undefined ? null : value), now]
    );
  }

  replaceAll(map, timestamp) {
    const now = timestamp || new Date().toISOString();
    const source = map && typeof map === 'object' ? map : {};
    const self = this;
    const keep = {};
    Object.keys(source).forEach(function (key) {
      keep[key] = true;
      self.set(key, source[key], now);
    });
    this.db.all('SELECT key FROM settings').forEach(function (row) {
      if (!keep[row.key]) self.db.run('DELETE FROM settings WHERE key = ?', [row.key]);
    });
  }
}

class CountersRepository {
  constructor(db) {
    this.db = db;
  }

  all() {
    const out = {};
    this.db.all('SELECT key, value FROM counters').forEach(function (row) {
      out[row.key] = Number(row.value) || 0;
    });
    return out;
  }

  set(key, value, timestamp) {
    const now = timestamp || new Date().toISOString();
    const numeric = Number(value);
    this.db.run(
      'INSERT INTO counters (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [key, Number.isFinite(numeric) ? Math.trunc(numeric) : 0, now]
    );
  }

  replaceAll(map, timestamp) {
    const now = timestamp || new Date().toISOString();
    const source = map && typeof map === 'object' ? map : {};
    const self = this;
    const keep = {};
    Object.keys(source).forEach(function (key) {
      keep[key] = true;
      self.set(key, source[key], now);
    });
    this.db.all('SELECT key FROM counters').forEach(function (row) {
      if (!keep[row.key]) self.db.run('DELETE FROM counters WHERE key = ?', [row.key]);
    });
  }
}

module.exports = { SettingsRepository: SettingsRepository, CountersRepository: CountersRepository };
