'use strict';

const { serializeCookie, sendJson, clientIp } = require('../http/helpers');

function register(router, app) {
  const config = app.config;

  router.post('/api/auth/login', async function (ctx) {
    const login = String(ctx.body.username || ctx.body.login || '').trim();
    const password = String(ctx.body.password || '');
    if (!login) throw badRequest('Enter your username or email to continue.');
    if (!password) throw badRequest('Enter your password to continue.');
    const result = await app.auth.login(login, password, {
      ip: clientIp(ctx.req),
      userAgent: ctx.req.headers['user-agent'] || ''
    });
    const cookie = serializeCookie(config.session.cookieName, result.session.id, {
      maxAge: Math.floor(config.session.ttlMs / 1000),
      secure: config.session.secure,
      sameSite: 'Strict'
    });
    sendJson(ctx.res, 200, { user: result.user, expiresAt: result.session.expiresAt }, { 'Set-Cookie': cookie });
  }, { public: true });

  router.post('/api/auth/logout', async function (ctx) {
    await app.auth.logout(ctx.sessionId, ctx.user ? ctx.user.id : null);
    const cookie = serializeCookie(config.session.cookieName, '', {
      maxAge: 0,
      secure: config.session.secure,
      sameSite: 'Strict'
    });
    sendJson(ctx.res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }, { public: true });

  router.get('/api/auth/session', function (ctx) {
    sendJson(ctx.res, 200, { user: ctx.user || null });
  }, { public: true });

  router.post('/api/auth/password', async function (ctx) {
    await app.auth.changePassword(
      ctx.user.id,
      String(ctx.body.currentPassword || ''),
      String(ctx.body.newPassword || '')
    );
    const cookie = serializeCookie(config.session.cookieName, '', {
      maxAge: 0,
      secure: config.session.secure,
      sameSite: 'Strict'
    });
    sendJson(ctx.res, 200, { ok: true }, { 'Set-Cookie': cookie });
  });
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'invalid_request';
  return error;
}

module.exports = { register: register };
