'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const initSqlJs = require('../vendor/sql-wasm.js');

const VENDOR_DIR = path.join(__dirname, '..', 'vendor');

class Sqlite {
  constructor(file, handle) {
    this.file = file;
    this.handle = handle;
    this.depth = 0;
    this.dirty = false;
    this.persistChain = Promise.resolve();
  }

  static async open(file) {
    const SQL = await initSqlJs({
      locateFile: function (name) { return path.join(VENDOR_DIR, name); }
    });
    await fsp.mkdir(path.dirname(file), { recursive: true });
    let handle;
    if (fs.existsSync(file)) {
      const buffer = await fsp.readFile(file);
      handle = new SQL.Database(new Uint8Array(buffer));
    } else {
      handle = new SQL.Database();
    }
    handle.run('PRAGMA foreign_keys = ON;');
    const db = new Sqlite(file, handle);
    if (!fs.existsSync(file)) await db.persist();
    return db;
  }

  exec(sql) {
    this.handle.exec(sql);
    this.dirty = true;
  }

  run(sql, params) {
    const stmt = this.handle.prepare(sql);
    try {
      stmt.bind(normalizeParams(params));
      stmt.step();
    } finally {
      stmt.free();
    }
    this.dirty = true;
  }

  all(sql, params) {
    const stmt = this.handle.prepare(sql);
    const rows = [];
    try {
      stmt.bind(normalizeParams(params));
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }

  get(sql, params) {
    const rows = this.all(sql, params);
    return rows.length ? rows[0] : null;
  }

  value(sql, params) {
    const row = this.get(sql, params);
    if (!row) return null;
    const keys = Object.keys(row);
    return keys.length ? row[keys[0]] : null;
  }

  transaction(fn) {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return fn();
      } finally {
        this.depth -= 1;
      }
    }
    this.handle.run('BEGIN');
    this.depth = 1;
    try {
      const result = fn();
      this.handle.run('COMMIT');
      this.dirty = true;
      return result;
    } catch (error) {
      try { this.handle.run('ROLLBACK'); } catch (rollbackError) { void rollbackError; }
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  persist() {
    this.persistChain = this.persistChain.then(async () => {
      const data = Buffer.from(this.handle.export());
      const tmp = this.file + '.tmp';
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, this.file);
      this.dirty = false;
    });
    return this.persistChain;
  }

  async write(fn) {
    const result = this.transaction(fn);
    await this.persist();
    return result;
  }

  async snapshot() {
    await this.persistChain;
    return Buffer.from(this.handle.export());
  }

  async close() {
    if (this.dirty) await this.persist();
    await this.persistChain;
    this.handle.close();
  }
}

function normalizeParams(params) {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params.map(normalizeValue);
  const out = {};
  Object.keys(params).forEach(function (key) {
    out[key.charAt(0) === ':' ? key : ':' + key] = normalizeValue(params[key]);
  });
  return out;
}

function normalizeValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

module.exports = Sqlite;
