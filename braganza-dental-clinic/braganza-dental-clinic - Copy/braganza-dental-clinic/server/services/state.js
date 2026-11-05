'use strict';

const { NAMES } = require('../repositories/collections');

const DEFAULT_SETTINGS = {
  clinicName: 'Braganza Dental Clinic',
  tagline: 'DENTAL CLINIC',
  address: '',
  phone: '',
  email: '',
  currency: '\u20b1',
  taxRate: 0,
  openTime: '08:00',
  closeTime: '18:00',
  slotMinutes: 30,
  workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  notifyAppointments: true,
  notifyLowStock: true,
  notifyPayments: true,
  autoConfirm: false,
  currentUser: 'DR-01'
};

const DEFAULT_COUNTERS = { ap: 1000, tr: 2000, inv: 5000, rx: 3000, pt: 0, staff: 1 };

const DEFAULT_DOCTOR = {
  id: 'DR-01',
  name: 'Dr. Mitchel C. Braganza',
  role: 'Administrator',
  specialty: 'General Dentistry',
  license: '',
  email: 'admin@braganzadental.ph',
  phone: '',
  active: true
};

class StateService {
  constructor(context) {
    this.db = context.db;
    this.records = context.records;
    this.settings = context.settings;
    this.counters = context.counters;
    this.audit = context.audit;
  }

  read() {
    const state = {};
    const self = this;
    NAMES.forEach(function (name) {
      state[name] = self.records.list(name);
    });
    state.settings = Object.assign({}, DEFAULT_SETTINGS, this.settings.all());
    state.counters = Object.assign({}, DEFAULT_COUNTERS, this.counters.all());
    return state;
  }

  validate(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw invalid('A state object is required');
    }
    if (!Array.isArray(state.patients)) throw invalid('state.patients must be an array');
    if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) {
      throw invalid('state.settings must be an object');
    }
    NAMES.forEach(function (name) {
      if (state[name] !== undefined && !Array.isArray(state[name])) {
        throw invalid('state.' + name + ' must be an array');
      }
      const list = Array.isArray(state[name]) ? state[name] : [];
      const seen = Object.create(null);
      list.forEach(function (record, index) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw invalid('state.' + name + '[' + index + '] must be an object');
        }
        if (!record.id || typeof record.id !== 'string') {
          throw invalid('state.' + name + '[' + index + '] is missing a string id');
        }
        if (seen[record.id]) throw invalid('Duplicate id in state.' + name + ': ' + record.id);
        seen[record.id] = true;
      });
    });
  }

  async replace(state, userId) {
    this.validate(state);
    const now = new Date().toISOString();
    const self = this;
    await this.db.write(function () {
      NAMES.forEach(function (name) {
        self.records.replaceAll(name, state[name] || [], now);
      });
      self.settings.replaceAll(Object.assign({}, DEFAULT_SETTINGS, state.settings || {}), now);
      self.counters.replaceAll(Object.assign({}, DEFAULT_COUNTERS, state.counters || {}), now);
      self.audit.record({
        at: now,
        userId: userId || null,
        action: 'state.replace',
        entity: 'state',
        detail: countsOf(state)
      });
    });
    return this.read();
  }

  async ensureSeed() {
    const self = this;
    const now = new Date().toISOString();
    const hasSettings = Number(this.db.value('SELECT COUNT(*) FROM settings') || 0) > 0;
    const hasCounters = Number(this.db.value('SELECT COUNT(*) FROM counters') || 0) > 0;
    const hasDoctors = this.records.count('doctors') > 0;
    if (hasSettings && hasCounters && hasDoctors) return false;
    await this.db.write(function () {
      if (!hasSettings) {
        Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
          self.settings.set(key, DEFAULT_SETTINGS[key], now);
        });
      }
      if (!hasCounters) {
        Object.keys(DEFAULT_COUNTERS).forEach(function (key) {
          self.counters.set(key, DEFAULT_COUNTERS[key], now);
        });
      }
      if (!hasDoctors) {
        self.records.upsert('doctors', Object.assign({}, DEFAULT_DOCTOR), 0, now);
      }
      self.audit.record({ at: now, action: 'state.seed', entity: 'state' });
    });
    return true;
  }
}

function countsOf(state) {
  const detail = {};
  NAMES.forEach(function (name) {
    detail[name] = Array.isArray(state[name]) ? state[name].length : 0;
  });
  return detail;
}

function invalid(message) {
  const error = new Error(message);
  error.status = 422;
  error.code = 'invalid_state';
  return error;
}

module.exports = {
  StateService: StateService,
  DEFAULT_SETTINGS: DEFAULT_SETTINGS,
  DEFAULT_COUNTERS: DEFAULT_COUNTERS,
  DEFAULT_DOCTOR: DEFAULT_DOCTOR
};
