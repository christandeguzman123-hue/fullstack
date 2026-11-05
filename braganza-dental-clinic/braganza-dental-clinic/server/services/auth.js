'use strict';

const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), useSalt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return { hash: derived.toString('hex'), salt: useSalt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  } catch (error) {
    void error;
    return false;
  }
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

class LoginThrottle {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  key(ip, login) {
    return String(ip || 'unknown') + '|' + String(login || '').toLowerCase();
  }

  check(ip, login) {
    const key = this.key(ip, login);
    const bucket = this.buckets.get(key);
    const now = Date.now();
    if (!bucket || now > bucket.resetAt) return { blocked: false, retryAfterMs: 0 };
    if (bucket.count < this.limit) return { blocked: false, retryAfterMs: 0 };
    return { blocked: true, retryAfterMs: bucket.resetAt - now };
  }

  fail(ip, login) {
    const key = this.key(ip, login);
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    bucket.count += 1;
  }

  clear(ip, login) {
    this.buckets.delete(this.key(ip, login));
  }

  sweep() {
    const now = Date.now();
    const buckets = this.buckets;
    buckets.forEach(function (bucket, key) {
      if (now > bucket.resetAt) buckets.delete(key);
    });
  }
}

class AuthService {
  constructor(context) {
    this.db = context.db;
    this.users = context.users;
    this.sessions = context.sessions;
    this.audit = context.audit;
    this.config = context.config;
    this.throttle = new LoginThrottle(
      context.config.security.loginMaxAttempts,
      context.config.security.loginWindowMs
    );
  }

  async ensureBootstrapAdmin() {
    if (this.users.count() > 0) return false;
    const admin = this.config.bootstrapAdmin;
    const credentials = hashPassword(admin.password);
    const now = new Date().toISOString();
    const self = this;
    await this.db.write(function () {
      self.users.create(
        {
          id: 'USR-' + crypto.randomBytes(8).toString('hex'),
          username: admin.username,
          email: admin.email,
          name: admin.name,
          role: 'Administrator',
          doctorId: admin.doctorId,
          passwordHash: credentials.hash,
          passwordSalt: credentials.salt,
          active: true
        },
        now
      );
      self.audit.record({ at: now, action: 'user.bootstrap', entity: 'user', entityId: admin.username });
    });
    return true;
  }

  async login(login, password, meta) {
    const throttled = this.throttle.check(meta.ip, login);
    if (throttled.blocked) {
      throw httpError(429, 'too_many_attempts', 'Too many sign-in attempts. Try again in a few minutes.', {
        retryAfter: Math.ceil(throttled.retryAfterMs / 1000)
      });
    }
    const user = this.users.findByLogin(login);
    const valid = user && user.active === 1 && verifyPassword(password, user.password_hash, user.password_salt);
    if (!valid) {
      this.throttle.fail(meta.ip, login);
      const self = this;
      await this.db.write(function () {
        self.audit.record({
          at: new Date().toISOString(),
          userId: user ? user.id : null,
          action: 'auth.login.failed',
          entity: 'user',
          entityId: String(login || '').slice(0, 120)
        });
      });
      throw httpError(401, 'invalid_credentials', 'Incorrect username or password.');
    }
    this.throttle.clear(meta.ip, login);
    const now = new Date();
    const session = {
      id: crypto.randomBytes(32).toString('hex'),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.session.ttlMs).toISOString(),
      userAgent: (meta.userAgent || '').slice(0, 255),
      ip: meta.ip || null
    };
    const self = this;
    await this.db.write(function () {
      self.sessions.purgeExpired(now.toISOString());
      self.sessions.create(session);
      self.users.touchLogin(user.id, now.toISOString());
      self.audit.record({ at: now.toISOString(), userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
    });
    return { session: session, user: publicUser(user) };
  }

  resolve(sessionId) {
    if (!sessionId) return null;
    const session = this.sessions.find(sessionId);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) return null;
    const user = this.users.findById(session.user_id);
    if (!user || user.active !== 1) return null;
    return { session: session, user: publicUser(user) };
  }

  async refresh(sessionId) {
    const expiresAt = new Date(Date.now() + this.config.session.ttlMs).toISOString();
    const self = this;
    await this.db.write(function () {
      self.sessions.touch(sessionId, expiresAt);
    });
    return expiresAt;
  }

  async logout(sessionId, userId) {
    if (!sessionId) return;
    const self = this;
    await this.db.write(function () {
      self.sessions.destroy(sessionId);
      self.audit.record({ at: new Date().toISOString(), userId: userId || null, action: 'auth.logout', entity: 'user', entityId: userId || null });
    });
  }

  async changePassword(userId, currentPassword, nextPassword) {
    const user = this.users.findById(userId);
    if (!user) throw httpError(404, 'user_not_found', 'Account not found.');
    if (!verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
      throw httpError(401, 'invalid_credentials', 'The current password is incorrect.');
    }
    if (!nextPassword || String(nextPassword).length < 8) {
      throw httpError(422, 'weak_password', 'The new password must be at least 8 characters long.');
    }
    const credentials = hashPassword(nextPassword);
    const now = new Date().toISOString();
    const self = this;
    await this.db.write(function () {
      self.users.updatePassword(userId, credentials.hash, credentials.salt, now);
      self.sessions.destroyForUser(userId);
      self.audit.record({ at: now, userId: userId, action: 'auth.password.changed', entity: 'user', entityId: userId });
    });
  }
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    role: row.role,
    doctorId: row.doctor_id,
    lastLoginAt: row.last_login_at
  };
}

function httpError(status, code, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (extra) error.extra = extra;
  return error;
}

module.exports = {
  AuthService: AuthService,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  publicUser: publicUser
};
