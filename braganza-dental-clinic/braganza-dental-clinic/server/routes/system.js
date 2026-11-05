'use strict';

const { sendJson } = require('../http/helpers');
const { NAMES } = require('../repositories/collections');

function register(router, app) {
  router.get('/api/health', function (ctx) {
    sendJson(ctx.res, 200, {
      status: 'ok',
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime())
    });
  }, { public: true });

  router.get('/api/stats', function (ctx) {
    const counts = {};
    NAMES.forEach(function (name) {
      counts[name] = app.records.count(name);
    });
    sendJson(ctx.res, 200, { counts: counts });
  });

  router.get('/api/audit', function (ctx) {
    const entries = app.audit.recent(ctx.query.limit).map(function (row) {
      let detail = null;
      if (row.detail) {
        try {
          detail = JSON.parse(row.detail);
        } catch (error) {
          void error;
          detail = row.detail;
        }
      }
      return {
        id: row.id,
        at: row.at,
        userId: row.user_id,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        detail: detail
      };
    });
    sendJson(ctx.res, 200, { entries: entries });
  });

  router.get('/api/backup', async function (ctx) {
    const buffer = await app.db.snapshot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    ctx.res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length,
      'Content-Disposition': 'attachment; filename="braganza-clinic-' + stamp + '.sqlite"',
      'Cache-Control': 'no-store'
    });
    ctx.res.end(buffer);
  });
}

module.exports = { register: register };
