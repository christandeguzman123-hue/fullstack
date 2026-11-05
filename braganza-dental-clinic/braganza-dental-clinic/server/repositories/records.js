'use strict';

const { definition } = require('./collections');

function quote(identifier) {
  return '"' + String(identifier).replace(/"/g, '""') + '"';
}

function scalar(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return null;
}

function projection(def, record) {
  const columns = ['id', 'ordinal', 'document', 'created_at', 'updated_at'];
  const values = {};
  Object.keys(def.columns).forEach(function (column) {
    columns.push(column);
    values[column] = scalar(record[def.columns[column]]);
  });
  return { columns: columns, values: values };
}

function decode(row) {
  const record = JSON.parse(row.document);
  record.id = row.id;
  return record;
}

class RecordRepository {
  constructor(db) {
    this.db = db;
  }

  list(name, options) {
    const def = definition(name);
    if (!def) throw notFound(name);
    const opts = options || {};
    const where = [];
    const params = [];
    if (opts.filters) {
      Object.keys(opts.filters).forEach(function (column) {
        if (!Object.prototype.hasOwnProperty.call(def.columns, column)) return;
        where.push(quote(column) + ' = ?');
        params.push(scalar(opts.filters[column]));
      });
    }
    let sql = 'SELECT id, document FROM ' + quote(def.table);
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY ordinal ASC, id ASC';
    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
      if (opts.offset) {
        sql += ' OFFSET ?';
        params.push(opts.offset);
      }
    }
    return this.db.all(sql, params).map(decode);
  }

  count(name) {
    const def = definition(name);
    if (!def) throw notFound(name);
    return Number(this.db.value('SELECT COUNT(*) FROM ' + quote(def.table)) || 0);
  }

  find(name, id) {
    const def = definition(name);
    if (!def) throw notFound(name);
    const row = this.db.get('SELECT id, document FROM ' + quote(def.table) + ' WHERE id = ?', [id]);
    return row ? decode(row) : null;
  }

  nextOrdinal(name) {
    const def = definition(name);
    if (!def) throw notFound(name);
    const max = this.db.value('SELECT MAX(ordinal) FROM ' + quote(def.table));
    return (Number(max) || 0) + 1;
  }

  upsert(name, record, ordinal, timestamp) {
    const def = definition(name);
    if (!def) throw notFound(name);
    if (!record || typeof record !== 'object' || !record.id) throw invalid('A record id is required');
    const now = timestamp || new Date().toISOString();
    const existing = this.db.get('SELECT created_at FROM ' + quote(def.table) + ' WHERE id = ?', [record.id]);
    const proj = projection(def, record);
    const placeholders = proj.columns.map(function () { return '?'; }).join(', ');
    const values = [
      record.id,
      Number.isFinite(ordinal) ? ordinal : this.nextOrdinal(name),
      JSON.stringify(record),
      existing ? existing.created_at : now,
      now
    ];
    Object.keys(def.columns).forEach(function (column) {
      values.push(proj.values[column]);
    });
    const assignments = proj.columns
      .filter(function (column) { return column !== 'id' && column !== 'created_at'; })
      .map(function (column) { return quote(column) + ' = excluded.' + quote(column); })
      .join(', ');
    const sql =
      'INSERT INTO ' + quote(def.table) + ' (' + proj.columns.map(quote).join(', ') + ') VALUES (' + placeholders + ') ' +
      'ON CONFLICT(id) DO UPDATE SET ' + assignments;
    this.db.run(sql, values);
    return record;
  }

  remove(name, id) {
    const def = definition(name);
    if (!def) throw notFound(name);
    const existing = this.db.get('SELECT id FROM ' + quote(def.table) + ' WHERE id = ?', [id]);
    if (!existing) return false;
    this.db.run('DELETE FROM ' + quote(def.table) + ' WHERE id = ?', [id]);
    return true;
  }

  ids(name) {
    const def = definition(name);
    if (!def) throw notFound(name);
    return this.db.all('SELECT id FROM ' + quote(def.table)).map(function (row) { return row.id; });
  }

  replaceAll(name, records, timestamp) {
    const def = definition(name);
    if (!def) throw notFound(name);
    const list = Array.isArray(records) ? records : [];
    const now = timestamp || new Date().toISOString();
    const keep = {};
    const self = this;
    list.forEach(function (record, index) {
      if (!record || typeof record !== 'object' || !record.id) return;
      keep[record.id] = true;
      self.upsert(name, record, index, now);
    });
    this.ids(name).forEach(function (id) {
      if (!keep[id]) self.db.run('DELETE FROM ' + quote(def.table) + ' WHERE id = ?', [id]);
    });
    return list.length;
  }
}

function notFound(name) {
  const error = new Error('Unknown collection: ' + name);
  error.status = 404;
  error.code = 'unknown_collection';
  return error;
}

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'invalid_record';
  return error;
}

module.exports = RecordRepository;
