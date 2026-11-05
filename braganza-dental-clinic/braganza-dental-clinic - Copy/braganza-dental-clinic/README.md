# Braganza Dental Clinic — Clinic Management System

Backend and API server for the existing single-file Braganza Dental Clinic front end.
The front end (`public/index.html`) keeps its original architecture, layout, styling and
behaviour; only its persistence and sign-in layers now talk to this server.

## Requirements

Node.js 18 or newer. Nothing else — the project has no npm dependencies and no build step.
SQLite is provided by a vendored WebAssembly build in `server/vendor/`, so there is no native
compilation and the same folder runs on Windows, macOS and Linux.

## Running it

Windows: double-click `start.bat`.
macOS / Linux: run `./start.sh`.

Either script starts the server and opens Google Chrome at <http://127.0.0.1:4400>.

To start it manually:

```
node server/index.js
```

Then open <http://127.0.0.1:4400> in Chrome.

Default sign-in: username `admin` (or `admin@braganzadental.ph`), password `braganza`.
Change it before real use:

```
npm run set-password -- admin your-new-password
```

## Tests

```
npm test
```

Runs the end-to-end suite in `tests/run.js` against a throwaway database: authentication,
snapshot round-trips, ordering, nested-record fidelity, validation, REST CRUD, static
serving, path-traversal blocking, restart durability and sign-out.

## Layout

```
braganza-dental-clinic/
├── public/index.html          front end (single file, unchanged apart from the API layer)
├── server/
│   ├── index.js               entry point
│   ├── app.js                 wiring, routing pipeline, security middleware
│   ├── config.js              configuration and .env loading
│   ├── db/                    SQLite engine wrapper, schema, migrations
│   ├── repositories/          data access
│   ├── services/              authentication and state services
│   ├── routes/                HTTP endpoints
│   ├── http/                  router, request helpers, static file server
│   └── vendor/                SQLite WebAssembly build (sql.js, MIT)
├── scripts/set-password.js
├── tests/run.js
├── data/                      SQLite database file, created on first run
├── start.bat / start.sh
└── .env.example
```

## Configuration

Copy `.env.example` to `.env` to override defaults. Settings: `HOST`, `PORT`, `DATA_DIR`,
`SESSION_COOKIE`, `SESSION_TTL_HOURS`, `SESSION_SECURE`, `LOGIN_MAX_ATTEMPTS`,
`LOGIN_WINDOW_MINUTES`, `MAX_BODY_BYTES`, `TRUSTED_ORIGINS`, and the `ADMIN_*` values used
only to create the first account.

## Data model

Every clinic collection has its own table. Each row stores the fields the application queries
on as typed, indexed columns, plus the complete record as JSON in a `document` column and an
`ordinal` column that preserves the array order the front end relies on. This keeps records
queryable from SQL without constraining the front end's record shape, and nested structures
such as invoice line items and prescription medications round-trip exactly.

Tables: `patients`, `doctors`, `appointments`, `treatments`, `invoices`, `prescriptions`,
`inventory`, `procedures`, `threads`, `notifications`, `settings`, `counters`, `users`,
`sessions`, `audit_log`, `schema_migrations`.

The database starts empty apart from clinic settings, ID counters and the `DR-01`
administrator record, matching the front end's own starting state.

## Front-end integration

Four regions of `public/index.html` changed; everything else is byte-identical to the
original file.

1. The persistence layer. `loadDB()` reads from `GET /api/state`. `saveDB()` writes through
   to `PUT /api/state`, debounced, with retry, a `visibilitychange` flush and a
   `beforeunload` beacon. `localStorage` is kept as an offline cache, so if the server stops
   responding the app keeps working on the device and syncs when it returns.
2. `signIn()` authenticates against `POST /api/auth/login` instead of comparing a password in
   the browser. The hardcoded credentials are gone from the client.
3. The sign-out action flushes pending changes, then calls `POST /api/auth/logout`.
4. The bootstrap call restores an existing session via `GET /api/auth/session` before
   rendering.

All 34 existing `saveDB()` call sites, every view, modal and action are untouched, because
`saveDB()` remains the single persistence chokepoint.

## API

All endpoints return JSON and require an authenticated session cookie except where noted.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Sign in (public) |
| POST | `/api/auth/logout` | Sign out (public) |
| GET | `/api/auth/session` | Current user or `null` (public) |
| POST | `/api/auth/password` | Change password, revokes sessions |
| GET | `/api/health` | Liveness (public) |
| GET | `/api/state` | Full clinic snapshot |
| PUT / POST | `/api/state` | Replace the snapshot in one transaction |
| GET | `/api/{collection}` | List, filterable by indexed field, `limit` / `offset` |
| POST | `/api/{collection}` | Create, generating an ID when none is supplied |
| GET | `/api/{collection}/{id}` | Read one |
| PUT | `/api/{collection}/{id}` | Replace one |
| PATCH | `/api/{collection}/{id}` | Merge fields into one |
| DELETE | `/api/{collection}/{id}` | Delete one |
| GET / PATCH | `/api/settings` | Clinic settings |
| GET / PATCH | `/api/counters` | ID counters |
| GET | `/api/stats` | Row counts per collection |
| GET | `/api/audit` | Recent audit entries |
| GET | `/api/backup` | Download the SQLite file |

`{collection}` is one of `patients`, `doctors`, `appointments`, `treatments`, `invoices`,
`prescriptions`, `inventory`, `procedures`, `threads`, `notifications`.

## Security

Passwords are hashed with scrypt and a per-user salt, and verified in constant time.
Sessions are server-side records referenced by an HttpOnly, SameSite=Strict cookie with a
sliding expiry; sign-out and password changes revoke them. Sign-in attempts are rate limited
per IP and username. Mutating requests are rejected if their `Origin` is not same-origin or
explicitly trusted. Request bodies are size-capped, snapshots are validated before any write,
and every write is recorded in `audit_log`. Responses carry `nosniff`, `X-Frame-Options`,
`Referrer-Policy` and a CSP. The server binds to `127.0.0.1` by default.

The CSP allows inline script and style because the front end is a single self-contained file
with inline `<style>` and `<script>` blocks, which is deliberate and unchanged.

## Backups

`GET /api/backup` downloads the live SQLite file. The front end's existing JSON backup and
restore buttons in Settings continue to work; a restore replaces the in-memory state and
syncs it to the server like any other change.

Writes are committed in a transaction and the database file is rewritten atomically via a
temporary file and rename, so an interrupted write cannot leave a partial file.
