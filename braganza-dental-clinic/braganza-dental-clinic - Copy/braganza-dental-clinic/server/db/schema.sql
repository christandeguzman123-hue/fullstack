CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Administrator',
  doctor_id     TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS patients (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  name       TEXT,
  phone      TEXT,
  email      TEXT,
  status     TEXT,
  age        INTEGER,
  gender     TEXT,
  last_visit TEXT,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);

CREATE TABLE IF NOT EXISTS doctors (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  name       TEXT,
  role       TEXT,
  specialty  TEXT,
  email      TEXT,
  phone      TEXT,
  active     INTEGER,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  patient_id TEXT,
  doctor_id  TEXT,
  date       TEXT,
  time       TEXT,
  type       TEXT,
  status     TEXT,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

CREATE TABLE IF NOT EXISTS treatments (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  patient_id TEXT,
  doctor_id  TEXT,
  date       TEXT,
  procedure  TEXT,
  category   TEXT,
  status     TEXT,
  cost       REAL,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_treatments_patient ON treatments(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatments_date ON treatments(date);

CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT PRIMARY KEY,
  ordinal      INTEGER NOT NULL DEFAULT 0,
  patient_id   TEXT,
  treatment_id TEXT,
  date         TEXT,
  due_date     TEXT,
  discount     REAL,
  paid         REAL,
  method       TEXT,
  document     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);

CREATE TABLE IF NOT EXISTS prescriptions (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  patient_id TEXT,
  doctor_id  TEXT,
  date       TEXT,
  diagnosis  TEXT,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);

CREATE TABLE IF NOT EXISTS inventory (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  name       TEXT,
  category   TEXT,
  qty        REAL,
  unit       TEXT,
  reorder    REAL,
  expiry     TEXT,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category);

CREATE TABLE IF NOT EXISTS procedures (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  name       TEXT,
  cat        TEXT,
  price      REAL,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  name       TEXT,
  role       TEXT,
  unread     INTEGER,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  route      TEXT,
  read       INTEGER,
  document   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  key        TEXT PRIMARY KEY,
  value      INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  user_id  TEXT,
  action   TEXT NOT NULL,
  entity   TEXT,
  entity_id TEXT,
  detail   TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
