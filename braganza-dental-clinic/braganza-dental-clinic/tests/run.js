'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bdc-test-'));
process.env.DATA_DIR = TEST_DIR;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'braganza';
process.env.NODE_ENV = 'test';

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write('  PASS  ' + label + '\n');
  } else {
    failed += 1;
    process.stdout.write('  FAIL  ' + label + (detail ? ' :: ' + detail : '') + '\n');
  }
}

function freshRequire() {
  Object.keys(require.cache).forEach(function (key) {
    if (key.indexOf(path.join(__dirname, '..', 'server')) === 0) delete require.cache[key];
  });
  return require('../server/app');
}

async function boot() {
  const { createApp } = freshRequire();
  const app = await createApp();
  await new Promise(function (resolve) { app.server.listen(0, '127.0.0.1', resolve); });
  const port = app.server.address().port;
  return { app: app, base: 'http://127.0.0.1:' + port };
}

function client(base) {
  let cookie = null;
  return async function call(method, url, body) {
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (error) { void error; data = text; }
    }
    return { status: res.status, data: data, headers: res.headers };
  };
}

async function main() {
  process.stdout.write('Braganza Dental Clinic backend tests\n');
  process.stdout.write('Data directory: ' + TEST_DIR + '\n\n');

  let ctx = await boot();
  let call = client(ctx.base);

  process.stdout.write('health and authentication\n');
  let res = await call('GET', '/api/health');
  check('health endpoint responds', res.status === 200 && res.data.status === 'ok', 'status ' + res.status);

  res = await call('GET', '/api/state');
  check('state requires authentication', res.status === 401, 'status ' + res.status);

  res = await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong-password' });
  check('bad password is rejected', res.status === 401, 'status ' + res.status);

  res = await call('GET', '/api/auth/session');
  check('session is empty before sign in', res.status === 200 && res.data.user === null);

  res = await call('POST', '/api/auth/login', { username: 'admin', password: 'braganza' });
  check('valid credentials sign in', res.status === 200 && res.data.user.username === 'admin', 'status ' + res.status);
  check('session cookie is httpOnly and strict', /HttpOnly/i.test(res.headers.get('set-cookie') || '') && /SameSite=Strict/i.test(res.headers.get('set-cookie') || ''));

  res = await call('POST', '/api/auth/login', { username: 'admin@braganzadental.ph', password: 'braganza' });
  check('email address also signs in', res.status === 200, 'status ' + res.status);

  process.stdout.write('\nseeded state\n');
  res = await call('GET', '/api/state');
  const seeded = res.data.state;
  check('state loads for a signed in user', res.status === 200);
  check('clinic starts with zero patients', seeded.patients.length === 0);
  check('clinic starts with zero appointments', seeded.appointments.length === 0 && seeded.invoices.length === 0);
  check('administrator record is present', seeded.doctors.length === 1 && seeded.doctors[0].id === 'DR-01');
  check('settings carry clinic defaults', seeded.settings.clinicName === 'Braganza Dental Clinic' && seeded.settings.currency === '\u20b1');
  check('work days survive as an array', Array.isArray(seeded.settings.workDays) && seeded.settings.workDays.length === 6);
  check('counters are seeded', seeded.counters.ap === 1000 && seeded.counters.inv === 5000);

  process.stdout.write('\nsnapshot synchronisation\n');
  const snapshot = JSON.parse(JSON.stringify(seeded));
  snapshot.patients = [
    { id: 'PT-2026-0002', name: 'Bea Alonzo', phone: '0917-000-0002', email: 'bea@example.com', age: 31, gender: 'Female', status: 'Active', lastVisit: '2026-09-01', notes: 'Second added, listed first' },
    { id: 'PT-2026-0001', name: 'Andres Cruz', phone: '0917-000-0001', email: 'andres@example.com', age: 44, gender: 'Male', status: 'Active', lastVisit: '2026-08-20' }
  ];
  snapshot.appointments = [
    { id: 'AP-1001', patientId: 'PT-2026-0001', doctorId: 'DR-01', date: '2026-09-10', time: '09:30', type: 'Check-up', status: 'Confirmed', notes: '' }
  ];
  snapshot.invoices = [
    {
      id: 'INV-5001',
      patientId: 'PT-2026-0001',
      treatmentId: '',
      date: '2026-09-01',
      dueDate: '2026-09-15',
      items: [{ desc: 'Prophylaxis', qty: 1, price: 1200 }, { desc: 'Fluoride', qty: 2, price: 350.5 }],
      discount: 100,
      paid: 500,
      method: 'GCash'
    }
  ];
  snapshot.counters.ap = 1001;
  snapshot.counters.pt = 2;
  snapshot.settings.address = 'M.Roxas St., Poblacion, Valencia City, Bukidnon';

  res = await call('PUT', '/api/state', { state: snapshot });
  check('snapshot is accepted', res.status === 200, 'status ' + res.status);

  res = await call('GET', '/api/state');
  const stored = res.data.state;
  check('patients persist', stored.patients.length === 2);
  check('insertion order is preserved', stored.patients[0].id === 'PT-2026-0002' && stored.patients[1].id === 'PT-2026-0001');
  check('nested invoice items persist', stored.invoices[0].items.length === 2 && stored.invoices[0].items[1].price === 350.5);
  check('numeric fields keep their type', stored.invoices[0].discount === 100 && stored.patients[1].age === 44);
  check('unmapped fields survive', stored.patients[0].notes === 'Second added, listed first');
  check('counters update', stored.counters.ap === 1001 && stored.counters.pt === 2);
  check('settings update', stored.settings.address === 'M.Roxas St., Poblacion, Valencia City, Bukidnon');

  const trimmed = JSON.parse(JSON.stringify(stored));
  trimmed.patients = trimmed.patients.filter(function (p) { return p.id !== 'PT-2026-0002'; });
  res = await call('PUT', '/api/state', trimmed);
  check('bare snapshot body is accepted', res.status === 200, 'status ' + res.status);
  res = await call('GET', '/api/state');
  check('deletes propagate to the database', res.data.state.patients.length === 1 && res.data.state.patients[0].id === 'PT-2026-0001');

  process.stdout.write('\nsnapshot validation\n');
  res = await call('PUT', '/api/state', { state: { patients: 'not-an-array', settings: {} } });
  check('malformed collections are rejected', res.status === 422, 'status ' + res.status);
  res = await call('PUT', '/api/state', { state: { patients: [{ name: 'No id' }], settings: {} } });
  check('records without an id are rejected', res.status === 422, 'status ' + res.status);
  res = await call('PUT', '/api/state', { state: { patients: [{ id: 'X' }, { id: 'X' }], settings: {} } });
  check('duplicate ids are rejected', res.status === 422, 'status ' + res.status);
  res = await call('GET', '/api/state');
  check('rejected writes leave data intact', res.data.state.patients.length === 1);

  process.stdout.write('\nrest resources\n');
  res = await call('POST', '/api/patients', { name: 'Carla Reyes', phone: '0917-000-0003', status: 'Active' });
  const createdId = res.data && res.data.item ? res.data.item.id : null;
  check('patient is created with a generated id', res.status === 201 && /^PT-\d{4}-\d{4}$/.test(createdId || ''), 'status ' + res.status);

  res = await call('GET', '/api/patients/' + createdId);
  check('patient is readable by id', res.status === 200 && res.data.item.name === 'Carla Reyes');

  res = await call('PATCH', '/api/patients/' + createdId, { status: 'Inactive' });
  check('patch merges fields', res.status === 200 && res.data.item.status === 'Inactive' && res.data.item.phone === '0917-000-0003');

  res = await call('GET', '/api/patients?status=Inactive');
  check('collection filters by indexed column', res.status === 200 && res.data.items.length === 1 && res.data.items[0].id === createdId);

  res = await call('POST', '/api/patients', { id: createdId, name: 'Duplicate' });
  check('duplicate id returns conflict', res.status === 409, 'status ' + res.status);

  res = await call('GET', '/api/patients/PT-DOES-NOT-EXIST');
  check('missing record returns not found', res.status === 404, 'status ' + res.status);

  res = await call('DELETE', '/api/patients/' + createdId);
  check('patient is deletable', res.status === 200);
  res = await call('GET', '/api/patients/' + createdId);
  check('deleted patient is gone', res.status === 404);

  res = await call('GET', '/api/appointments?patientId=PT-2026-0001');
  check('appointments filter by patient', res.status === 200 && res.data.items.length === 1);

  res = await call('PATCH', '/api/settings', { phone: '(088) 000-0000' });
  check('settings patch applies', res.status === 200 && res.data.settings.phone === '(088) 000-0000');

  res = await call('GET', '/api/stats');
  check('stats report row counts', res.status === 200 && res.data.counts.patients === 1);

  res = await call('GET', '/api/audit?limit=5');
  check('audit trail records writes', res.status === 200 && res.data.entries.length > 0);

  res = await call('GET', '/api/unknown-endpoint');
  check('unknown endpoint returns 404 json', res.status === 404 && res.data.error.code === 'not_found');

  res = await call('DELETE', '/api/state');
  check('unsupported method returns 405', res.status === 405, 'status ' + res.status);

  process.stdout.write('\nstatic frontend\n');
  const page = await fetch(ctx.base + '/');
  const html = await page.text();
  check('index page is served', page.status === 200 && /Braganza Dental Clinic/.test(html));
  check('security headers are present', page.headers.get('x-content-type-options') === 'nosniff' && !!page.headers.get('content-security-policy'));
  check('frontend has no hardcoded password', html.indexOf('ADMIN_PASSWORD') === -1);
  const traversal = await fetch(ctx.base + '/../package.json');
  check('path traversal is blocked', traversal.status === 404 || traversal.status === 403, 'status ' + traversal.status);

  process.stdout.write('\ndurability across restart\n');
  await ctx.app.close();
  ctx = await boot();
  call = client(ctx.base);
  res = await call('POST', '/api/auth/login', { username: 'admin', password: 'braganza' });
  check('credentials survive a restart', res.status === 200, 'status ' + res.status);
  res = await call('GET', '/api/state');
  check('records survive a restart', res.status === 200 && res.data.state.patients.length === 1 && res.data.state.patients[0].name === 'Andres Cruz');
  check('nested data survives a restart', res.data.state.invoices[0].items.length === 2);
  check('settings survive a restart', res.data.state.settings.phone === '(088) 000-0000');

  process.stdout.write('\nsign out\n');
  res = await call('POST', '/api/auth/logout');
  check('sign out succeeds', res.status === 200);
  res = await call('GET', '/api/state');
  check('session is invalid after sign out', res.status === 401, 'status ' + res.status);

  await ctx.app.close();

  process.stdout.write('\n' + passed + ' passed, ' + failed + ' failed\n');
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(function (error) {
  process.stderr.write('Test run failed: ' + (error && error.stack ? error.stack : error) + '\n');
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  process.exit(1);
});
