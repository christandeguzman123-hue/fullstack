'use strict';

class UserRepository {
  constructor(db) {
    this.db = db;
  }

  count() {
    return Number(this.db.value('SELECT COUNT(*) FROM users') || 0);
  }

  findById(id) {
    return this.db.get('SELECT * FROM users WHERE id = ?', [id]);
  }

  findByLogin(login) {
    const value = String(login || '').trim().toLowerCase();
    if (!value) return null;
    return this.db.get(
      'SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ? LIMIT 1',
      [value, value]
    );
  }

  create(user, timestamp) {
    const now = timestamp || new Date().toISOString();
    this.db.run(
      'INSERT INTO users (id, username, email, name, role, doctor_id, password_hash, password_salt, active, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        user.id,
        user.username,
        user.email || null,
        user.name,
        user.role || 'Administrator',
        user.doctorId || null,
        user.passwordHash,
        user.passwordSalt,
        user.active === false ? 0 : 1,
        now,
        now
      ]
    );
    return this.findById(user.id);
  }

  updatePassword(id, hash, salt, timestamp) {
    const now = timestamp || new Date().toISOString();
    this.db.run('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?', [hash, salt, now, id]);
  }

  touchLogin(id, timestamp) {
    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [timestamp || new Date().toISOString(), id]);
  }
}

class SessionRepository {
  constructor(db) {
    this.db = db;
  }

  create(session) {
    this.db.run(
      'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [session.id, session.userId, session.createdAt, session.expiresAt, session.userAgent || null, session.ip || null]
    );
  }

  find(id) {
    if (!id) return null;
    return this.db.get('SELECT * FROM sessions WHERE id = ?', [id]);
  }

  touch(id, expiresAt) {
    this.db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', [expiresAt, id]);
  }

  destroy(id) {
    this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
  }

  destroyForUser(userId) {
    this.db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  purgeExpired(now) {
    this.db.run('DELETE FROM sessions WHERE expires_at <= ?', [now || new Date().toISOString()]);
  }
}

class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  record(entry) {
    this.db.run(
      'INSERT INTO audit_log (at, user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
      [
        entry.at || new Date().toISOString(),
        entry.userId || null,
        entry.action,
        entry.entity || null,
        entry.entityId || null,
        entry.detail ? JSON.stringify(entry.detail) : null
      ]
    );
  }

  recent(limit) {
    const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    return this.db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [max]);
  }
}

module.exports = {
  UserRepository: UserRepository,
  SessionRepository: SessionRepository,
  AuditRepository: AuditRepository
};
