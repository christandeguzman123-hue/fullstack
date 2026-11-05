'use strict';

const http = require('http');
const { URL } = require('url');

const config = require('./config');
const Sqlite = require('./db/sqlite');
const { migrate } = require('./db/migrate');
const RecordRepository = require('./repositories/records');
const { SettingsRepository, CountersRepository } = require('./repositories/keyvalue');
const { UserRepository, SessionRepository, AuditRepository } = require('./repositories/accounts');
const { StateService } = require('./services/state');
const { AuthService } = require('./services/auth');
const Router = require('./http/router');
const { createStaticHandler } = require('./http/static');
const helpers = require('./http/helpers');

const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');
const resourceRoutes = require('./routes/resources');
const systemRoutes = require('./routes/system');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join('; ')
};

async function createApp() {
  const db = await Sqlite.open(config.databaseFile);
  await migrate(db);

  const app = {
    config: config,
    db: db,
    records: new RecordRepository(db),
    settings: new SettingsRepository(db),
    counters: new CountersRepository(db),
    users: new UserRepository(db),
    sessions: new SessionRepository(db),
    audit: new AuditRepository(db)
  };

  app.state = new StateService(app);
  app.auth = new AuthService({
    db: db,
    users: app.users,
    sessions: app.sessions,
    audit: app.audit,
    config: config
  });

  await app.state.ensureSeed();
  await app.auth.ensureBootstrapAdmin();

  const router = new Router();
  authRoutes.register(router, app);
  stateRoutes.register(router, app);
  resourceRoutes.register(router, app);
  systemRoutes.register(router, app);

  const serveStatic = createStaticHandler(config.publicDir);

  const server = http.createServer(function (req, res) {
    handle(req, res, app, router, serveStatic).catch(function (error) {
      if (!res.headersSent) helpers.sendError(res, error);
      else res.end();
    });
  });

  const sweeper = setInterval(function () {
    app.auth.throttle.sweep();
    db.write(function () {
      app.sessions.purgeExpired(new Date().toISOString());
    }).catch(function () { return null; });
  }, 15 * 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  app.server = server;
  app.close = async function () {
    clearInterval(sweeper);
    await new Promise(function (resolve) { server.close(resolve); });
    await db.close();
  };

  return app;
}

async function handle(req, res, app, router, serveStatic) {
  Object.keys(SECURITY_HEADERS).forEach(function (name) {
    res.setHeader(name, SECURITY_HEADERS[name]);
  });

  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }
    const served = await serveStatic(req, res, pathname);
    if (served) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const match = router.match(req.method, pathname);
  if (!match) {
    helpers.sendError(res, httpError(404, 'not_found', 'No such endpoint.'));
    return;
  }
  if (match.methodNotAllowed) {
    helpers.sendError(res, httpError(405, 'method_not_allowed', 'This endpoint does not accept ' + req.method + '.'));
    return;
  }

  const mutating = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
  if (mutating && !originAllowed(req, app.config)) {
    helpers.sendError(res, httpError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.'));
    return;
  }

  const cookies = helpers.parseCookies(req.headers.cookie);
  const sessionId = cookies[app.config.session.cookieName] || null;
  const resolved = app.auth.resolve(sessionId);

  if (!match.route.options.public && !resolved) {
    helpers.sendError(res, httpError(401, 'unauthenticated', 'Sign in to continue.'));
    return;
  }

  let body = {};
  if (mutating) {
    const raw = await helpers.readBody(req, app.config.security.maxBodyBytes);
    body = helpers.parseJsonBody(raw);
  }

  const query = {};
  url.searchParams.forEach(function (value, key) {
    query[key] = value;
  });

  const ctx = {
    req: req,
    res: res,
    app: app,
    params: match.params,
    query: query,
    body: body,
    sessionId: sessionId,
    session: resolved ? resolved.session : null,
    user: resolved ? resolved.user : null
  };

  if (resolved) await maybeRefresh(app, resolved);

  await match.route.handler(ctx);
}

async function maybeRefresh(app, resolved) {
  const remaining = new Date(resolved.session.expires_at).getTime() - Date.now();
  if (remaining > app.config.session.ttlMs / 2) return;
  await app.auth.refresh(resolved.session.id);
}

function originAllowed(req, cfg) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (cfg.security.trustedOrigins.indexOf(origin) !== -1) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (error) {
    void error;
    return false;
  }
  return parsed.host === req.headers.host;
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

module.exports = { createApp: createApp };
