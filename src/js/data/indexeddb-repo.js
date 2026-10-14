import {
  compareApplicationEvents,
  compareApplications,
  compareEmployments,
  comparePayrollEntries,
  compareShifts
} from './contract.js';
import { DataError } from './errors.js';
import { normalizeTimestamp } from './normalize-timestamp.js';
import { computeWorkedMinutes } from '../shared/hours.js';
import {
  APPLICATION_DEFAULTS,
  EMPLOYMENT_DEFAULTS,
  PAYROLL_ENTRY_DEFAULTS,
  PROFILE_DEFAULTS,
  SHIFT_DEFAULTS,
  normalizeHourlyRate,
  normalizePayrollAmount,
  validateApplication,
  validateApplicationEvent,
  validateDateRange,
  validateEmployment,
  validateProfile,
  validatePayrollEntry,
  validateShift
} from './validation.js';

export const LOCAL_DATABASE_NAME = 'workpath-local';
const DATABASE_VERSION = 2;
const PROFILE_ID_KEY = 'local-user-id';
const PERSISTENCE_KEY = 'storage-persistence';

const MESSAGES = {
  quota: 'Your device is out of storage space. Free up space on this device and try again.',
  unavailable: 'Local storage is unavailable in this browser. Check your browser settings or exit private browsing, then try again.',
  upgrade: 'Workpath could not update local storage because another tab is using it. Close other Workpath tabs and try again.',
  deleteBlocked: 'Workpath could not delete local data. Close other Workpath tabs and try again.',
  read: 'We could not load local data. Please try again.',
  write: 'We could not save local data. Please try again.'
};

/** Create the IndexedDB implementation of the current Workpath repo contract. */
export function createIndexedDbRepo({ getUserId, databaseName = LOCAL_DATABASE_NAME } = {}) {
  let databasePromise = null;
  let database = null;

  function open() {
    if (!databasePromise) {
      databasePromise = openDatabase(databaseName).then((connection) => {
        database = connection;
        connection.onversionchange = () => {
          connection.close();
          if (database === connection) {
            database = null;
            databasePromise = null;
          }
        };
        return connection;
      }).catch((error) => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  }

  async function userId() {
    const id = await getUserId?.();
    if (!id) throw new DataError('permission', 'Your session ended. Please sign in again.');
    return id;
  }

  async function withTransaction(storeNames, mode, operation) {
    let tx;
    try {
      const db = await open();
      tx = db.transaction(storeNames, mode);
    } catch (error) {
      throw mapStorageError(error, mode);
    }
    const completed = transactionCompletion(tx);
    try {
      const result = await operation(tx);
      await completed;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* the transaction may already be complete */ }
      await completed.catch(() => {});
      throw mapStorageError(error, mode);
    }
  }

  async function ensureProfile(tx, owner) {
    const store = tx.objectStore('profiles');
    const found = await requestResult(store.get(owner));
    if (found) return found;
    const profile = {
      ...PROFILE_DEFAULTS,
      id: owner,
      created_at: new Date().toISOString()
    };
    await requestResult(store.add(profile));
    return profile;
  }

  async function ownRecord(tx, storeName, id, kind, customMessage) {
    const owner = await userId();
    const row = await requestResult(tx.objectStore(storeName).get(id));
    if (!row || row.user_id !== owner) {
      throw new DataError('not_found', customMessage || missingMessage(kind));
    }
    return row;
  }

  async function checkEmploymentReference(tx, employmentId) {
    if (!employmentId) return;
    const owner = await userId();
    const row = await requestResult(tx.objectStore('employments').get(employmentId));
    if (!row || row.user_id !== owner) {
      throw new DataError('permission', 'Choose one of your jobs or select no employer.');
    }
  }

  async function checkApplicationReference(tx, applicationId) {
    const owner = await userId();
    const applications = tx.objectStore('applications');
    const row = await requestResult(applications.get(applicationId));
    if (row?.user_id === owner) return;
    if (row) throw new DataError('permission', 'You can only change events on your own applications.');
    throw new DataError('not_found', 'This application is no longer available.');
  }

  async function insertApplicationEvent(input) {
    const owner = await userId();
    const values = withoutIdentity(input);
    return withTransaction(['applications', 'applicationEvents'], 'readwrite', async (tx) => {
      validateApplicationEvent(values);
      await checkApplicationReference(tx, values.application_id);
      const normalizedValues = normalizeEventValues(values);
      const row = { notes: null, ...normalizedValues, id: newId(), user_id: owner };
      await requestResult(tx.objectStore('applicationEvents').add(row));
      return normalizeApplicationEvent(row);
    });
  }

  async function updateApplication(id, values) {
    const owner = await userId();
    const updates = withoutIdentity(values);
    return withTransaction('applications', 'readwrite', async (tx) => {
      const row = await ownRecord(tx, 'applications', id, 'application', 'We could not find this application to update. Refresh the page and try again.');
      const candidate = { ...row, ...updates };
      validateApplication(candidate);
      const updated = { ...candidate, updated_at: new Date().toISOString() };
      await requestResult(tx.objectStore('applications').put(updated));
      return normalizeApplication(updated);
    });
  }

  return {
    profile: {
      async get() {
        const owner = await userId();
        return withTransaction('profiles', 'readwrite', async (tx) => {
          return copy(await ensureProfile(tx, owner));
        });
      },
      async update(values) {
        const owner = await userId();
        return withTransaction('profiles', 'readwrite', async (tx) => {
          const row = await ensureProfile(tx, owner);
          const updates = withoutIdentity(values);
          const candidate = { ...row, ...updates };
          validateProfile(candidate);
          const updated = { ...candidate, id: owner, created_at: row.created_at };
          await requestResult(tx.objectStore('profiles').put(updated));
          return copy(updated);
        });
      }
    },
    employments: {
      async list() {
        const owner = await userId();
        return withTransaction('employments', 'readonly', async (tx) => {
          const rows = await requestResult(tx.objectStore('employments').getAll());
          return rows.filter((row) => row.user_id === owner).sort(compareEmployments).map(normalizeEmployment);
        });
      },
      async create(input) {
        const owner = await userId();
        const candidate = { ...EMPLOYMENT_DEFAULTS, ...withoutIdentity(input) };
        validateEmployment(candidate);
        const row = { ...candidate, hourly_rate: normalizeHourlyRate(candidate.hourly_rate), id: newId(), user_id: owner };
        return withTransaction('employments', 'readwrite', async (tx) => {
          await requestResult(tx.objectStore('employments').add(row));
          return normalizeEmployment(row);
        });
      },
      async update(id, input) {
        const owner = await userId();
        const updates = withoutIdentity(input);
        return withTransaction('employments', 'readwrite', async (tx) => {
          const row = await ownRecord(tx, 'employments', id, 'employment');
          const candidate = { ...row, ...updates };
          validateEmployment(candidate);
          if (updates.hourly_rate !== undefined) candidate.hourly_rate = normalizeHourlyRate(updates.hourly_rate);
          await requestResult(tx.objectStore('employments').put(candidate));
          return normalizeEmployment(candidate);
        });
      },
      async remove(id) {
        const owner = await userId();
        return withTransaction(['employments', 'shifts', 'payroll_entries'], 'readwrite', async (tx) => {
          const employments = tx.objectStore('employments');
          const row = await requestResult(employments.get(id));
          if (!row || row.user_id !== owner) return;
          const shifts = tx.objectStore('shifts');
          const rows = await requestResult(shifts.getAll());
          for (const shift of rows) {
            if (shift.user_id === owner && shift.employment_id === id) {
              await requestResult(shifts.put({ ...shift, employment_id: null }));
            }
          }
          const payrollEntries = tx.objectStore('payroll_entries');
          const entries = await requestResult(payrollEntries.index('employment_id').getAll(id));
          for (const entry of entries) {
            if (entry.user_id === owner) await requestResult(payrollEntries.put({ ...entry, employment_id: null }));
          }
          await requestResult(employments.delete(id));
        });
      }
    },
    shifts: {
      async listBetween(fromDate, toDate) {
        validateDateRange(fromDate, toDate);
        const owner = await userId();
        return withTransaction('shifts', 'readonly', async (tx) => {
          const rows = await requestResult(tx.objectStore('shifts').getAll());
          return rows.filter((row) => row.user_id === owner && row.work_date >= fromDate && row.work_date <= toDate)
            .sort(compareShifts).map(normalizeShift);
        });
      },
      async create(input) {
        const owner = await userId();
        const candidate = { ...SHIFT_DEFAULTS, ...withoutDerived(input) };
        validateShift(candidate);
        const row = { ...normalizeShiftValues(candidate), id: newId(), user_id: owner };
        return withTransaction(['shifts', 'employments'], 'readwrite', async (tx) => {
          await checkEmploymentReference(tx, row.employment_id);
          await requestResult(tx.objectStore('shifts').add(row));
          return normalizeShift(row);
        });
      },
      async update(id, input) {
        const owner = await userId();
        const updates = withoutDerived(input);
        return withTransaction(['shifts', 'employments'], 'readwrite', async (tx) => {
          const row = await ownRecord(tx, 'shifts', id, 'shift');
          const candidate = { ...row, ...updates };
          validateShift(candidate);
          await checkEmploymentReference(tx, candidate.employment_id);
          const normalized = { ...row, ...normalizeShiftValues(updates) };
          await requestResult(tx.objectStore('shifts').put(normalized));
          return normalizeShift(normalized);
        });
      },
      async remove(id) {
        const owner = await userId();
        return withTransaction('shifts', 'readwrite', async (tx) => {
          const store = tx.objectStore('shifts');
          const row = await requestResult(store.get(id));
          if (row?.user_id === owner) await requestResult(store.delete(id));
        });
      }
    },
    applications: {
      async list({ limit } = {}) {
        const owner = await userId();
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
          throw new DataError('validation', 'Application limit must be a whole number of zero or more.');
        }
        return withTransaction('applications', 'readonly', async (tx) => {
          const rows = await requestResult(tx.objectStore('applications').getAll());
          let own = rows.filter((row) => row.user_id === owner).sort(compareApplications);
          if (limit !== undefined) own = own.slice(0, limit);
          return own.map(normalizeApplication);
        });
      },
      async create(input) {
        const owner = await userId();
        const candidate = { ...APPLICATION_DEFAULTS, ...withoutIdentity(input) };
        validateApplication(candidate);
        const row = { ...candidate, id: newId(), user_id: owner, updated_at: new Date().toISOString() };
        return withTransaction('applications', 'readwrite', async (tx) => {
          await requestResult(tx.objectStore('applications').add(row));
          return normalizeApplication(row);
        });
      },
      update: updateApplication,
      async remove(id) {
        const owner = await userId();
        return withTransaction(['applications', 'applicationEvents'], 'readwrite', async (tx) => {
          const applications = tx.objectStore('applications');
          const row = await requestResult(applications.get(id));
          if (!row || row.user_id !== owner) return;
          const events = tx.objectStore('applicationEvents');
          const rows = await requestResult(events.index('application_id').getAll(id));
          for (const event of rows) {
            if (event.user_id === owner) await requestResult(events.delete(event.id));
          }
          await requestResult(applications.delete(id));
        });
      },
      async changeStatus(id, newStatus) {
        const owner = await userId();
        const current = await withTransaction('applications', 'readonly', async (tx) => {
          return ownRecord(tx, 'applications', id, 'application', 'We could not find this application to update. Refresh the page and try again.');
        });
        validateApplication({ ...current, status: newStatus });
        if (current.status === newStatus) return { application: normalizeApplication(current), warning: false };
        const application = await updateApplication(id, { status: newStatus });
        let warning = false;
        try {
          await insertApplicationEvent({
            application_id: id,
            event_type: 'status_changed',
            event_date: new Date().toISOString(),
            notes: current.status + ' -> ' + newStatus
          });
        } catch {
          warning = true;
        }
        return { application, warning };
      }
    },
    applicationEvents: {
      async listForApplication(applicationId) {
        const owner = await userId();
        return withTransaction('applicationEvents', 'readonly', async (tx) => {
          const rows = await requestResult(tx.objectStore('applicationEvents').index('application_id').getAll(applicationId));
          return rows.filter((row) => row.user_id === owner).sort(compareApplicationEvents).map(normalizeApplicationEvent);
        });
      },
      create: insertApplicationEvent,
      async update(id, input) {
        const owner = await userId();
        const updates = withoutIdentity(input);
        return withTransaction(['applicationEvents', 'applications'], 'readwrite', async (tx) => {
          const row = await ownRecord(tx, 'applicationEvents', id, 'application_event', 'We could not find this timeline event to update. Refresh the page and try again.');
          const candidate = { ...row, ...updates };
          validateApplicationEvent(candidate);
          await checkApplicationReference(tx, candidate.application_id);
          const normalized = { ...row, ...normalizeEventValues(updates) };
          await requestResult(tx.objectStore('applicationEvents').put(normalized));
          return normalizeApplicationEvent(normalized);
        });
      },
      async remove(id) {
        const owner = await userId();
        return withTransaction('applicationEvents', 'readwrite', async (tx) => {
          const store = tx.objectStore('applicationEvents');
          const row = await requestResult(store.get(id));
          if (row?.user_id === owner) await requestResult(store.delete(id));
        });
      }
    },
    payrollEntries: {
      async list({ limit } = {}) {
        const owner = await userId();
        validatePayrollLimit(limit);
        return withTransaction('payroll_entries', 'readonly', async (tx) => {
          let rows = (await requestResult(tx.objectStore('payroll_entries').getAll()))
            .filter((row) => row.user_id === owner).sort(comparePayrollEntries);
          if (limit !== undefined) rows = rows.slice(0, limit);
          return rows.map(normalizePayrollEntry);
        });
      },
      async listBetween(fromDate, toDate) {
        validateDateRange(fromDate, toDate);
        const owner = await userId();
        return withTransaction('payroll_entries', 'readonly', async (tx) => {
          return (await requestResult(tx.objectStore('payroll_entries').getAll()))
            .filter((row) => row.user_id === owner && row.pay_date >= fromDate && row.pay_date <= toDate)
            .sort(comparePayrollEntries).map(normalizePayrollEntry);
        });
      },
      async create(input) {
        const owner = await userId();
        const candidate = { ...PAYROLL_ENTRY_DEFAULTS, ...withoutIdentity(input) };
        validatePayrollEntry(candidate);
        const row = { ...normalizePayrollEntryValues(candidate), id: newId(), user_id: owner };
        return withTransaction(['payroll_entries', 'employments'], 'readwrite', async (tx) => {
          await checkEmploymentReference(tx, row.employment_id);
          await requestResult(tx.objectStore('payroll_entries').add(row));
          return normalizePayrollEntry(row);
        });
      },
      async update(id, input) {
        const owner = await userId();
        const updates = withoutIdentity(input);
        return withTransaction(['payroll_entries', 'employments'], 'readwrite', async (tx) => {
          const row = await ownRecord(tx, 'payroll_entries', id, 'payroll_entry');
          const candidate = { ...row, ...updates };
          validatePayrollEntry(candidate);
          await checkEmploymentReference(tx, candidate.employment_id);
          const normalized = { ...row, ...normalizePayrollEntryValues(updates) };
          await requestResult(tx.objectStore('payroll_entries').put(normalized));
          return normalizePayrollEntry(normalized);
        });
      },
      async remove(id) {
        const owner = await userId();
        return withTransaction('payroll_entries', 'readwrite', async (tx) => {
          const store = tx.objectStore('payroll_entries');
          const row = await requestResult(store.get(id));
          if (row?.user_id === owner) await requestResult(store.delete(id));
        });
      }
    },
    storage: {
      async getPersistenceState() {
        return withTransaction('meta', 'readonly', async (tx) => {
          return (await requestResult(tx.objectStore('meta').get(PERSISTENCE_KEY)))?.value || { requested: false, protected: false };
        });
      },
      async markPersistenceRequested() {
        return withTransaction('meta', 'readwrite', async (tx) => {
          const store = tx.objectStore('meta');
          const row = await requestResult(store.get(PERSISTENCE_KEY));
          if (row?.value?.requested) return false;
          await requestResult(store.put({ key: PERSISTENCE_KEY, value: { requested: true, protected: false } }));
          return true;
        });
      },
      async setPersistenceProtected(isProtected) {
        return withTransaction('meta', 'readwrite', async (tx) => {
          await requestResult(tx.objectStore('meta').put({
            key: PERSISTENCE_KEY,
            value: { requested: true, protected: Boolean(isProtected) }
          }));
        });
      }
    },
    async getOrCreateLocalUserId() {
      return withTransaction('meta', 'readwrite', async (tx) => {
        const store = tx.objectStore('meta');
        const row = await requestResult(store.get(PROFILE_ID_KEY));
        if (row?.value) return row.value;
        const id = newId();
        await requestResult(store.put({ key: PROFILE_ID_KEY, value: id }));
        return id;
      });
    },
    async hasLocalProfile() {
      return withTransaction(['meta', 'profiles'], 'readonly', async (tx) => {
        const row = await requestResult(tx.objectStore('meta').get(PROFILE_ID_KEY));
        if (!row?.value) return false;
        return Boolean(await requestResult(tx.objectStore('profiles').get(row.value)));
      });
    },
    close() {
      if (database) database.close();
      database = null;
      databasePromise = null;
    },
    async deleteDatabase() {
      this.close();
      return deleteIndexedDbDatabase(databaseName);
    }
  };
}

/** Check for an existing local profile without creating a user or profile. */
export async function hasLocalProfile({ databaseName = LOCAL_DATABASE_NAME } = {}) {
  let db;
  try {
    if (!await databaseExists(databaseName)) return false;
    db = await openDatabase(databaseName);
    const result = await runExternalTransaction(db, ['meta', 'profiles'], 'readonly', async (tx) => {
      const row = await requestResult(tx.objectStore('meta').get(PROFILE_ID_KEY));
      if (!row?.value) return false;
      return Boolean(await requestResult(tx.objectStore('profiles').get(row.value)));
    });
    return result;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

async function databaseExists(databaseName) {
  if (typeof globalThis.indexedDB === 'undefined') return false;
  if (typeof globalThis.indexedDB.databases === 'function') {
    try {
      const databases = await globalThis.indexedDB.databases();
      return databases.some((entry) => entry.name === databaseName);
    } catch {
      return false;
    }
  }
  return new Promise((resolve) => {
    let createdDuringCheck = false;
    let settled = false;
    let request;
    try {
      request = globalThis.indexedDB.open(databaseName);
    } catch {
      resolve(false);
      return;
    }
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        createdDuringCheck = true;
        try { request.transaction.abort(); } catch { /* opening the empty database is cancelled */ }
      }
    };
    request.onsuccess = () => {
      request.result.close();
      if (!settled) {
        settled = true;
        resolve(!createdDuringCheck);
      }
    };
    request.onerror = () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    };
    request.onblocked = () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    };
  });
}

/** Delete the named database after its repository connection has been closed. */
export function deleteIndexedDbDatabase(databaseName = LOCAL_DATABASE_NAME) {
  if (typeof globalThis.indexedDB === 'undefined') {
    return Promise.reject(new DataError('unknown', MESSAGES.unavailable));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    try {
      request = globalThis.indexedDB.deleteDatabase(databaseName);
    } catch (error) {
      reject(mapStorageError(error, 'readwrite'));
      return;
    }
    request.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(mapStorageError(request.error, 'readwrite'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new DataError('unknown', MESSAGES.deleteBlocked));
    };
  });
}

function openDatabase(databaseName) {
  if (typeof globalThis.indexedDB === 'undefined') {
    return Promise.reject(new DataError('unknown', MESSAGES.unavailable));
  }
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    try {
      request = globalThis.indexedDB.open(databaseName, DATABASE_VERSION);
    } catch (error) {
      reject(mapStorageError(error, 'readonly'));
      return;
    }
    request.onupgradeneeded = (event) => {
      try {
        upgradeDatabase(request.result, event.oldVersion);
      } catch (error) {
        try { request.transaction.abort(); } catch { /* the upgrade may already have failed */ }
        if (!settled) {
          settled = true;
          reject(mapStorageError(error, 'readwrite'));
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(mapStorageError(request.error, 'readonly'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new DataError('unknown', MESSAGES.upgrade));
    };
  });
}

function upgradeDatabase(db, oldVersion) {
  if (oldVersion < 1) {
    createStore(db, 'profiles', 'id');
    createStore(db, 'employments', 'id', [['user_id', 'user_id']]);
    createStore(db, 'shifts', 'id', [
      ['user_id', 'user_id'],
      ['user_id_work_date', ['user_id', 'work_date']],
      ['employment_id', 'employment_id']
    ]);
    createStore(db, 'applications', 'id', [
      ['user_id', 'user_id'],
      ['user_id_date_applied', ['user_id', 'date_applied']],
      ['user_id_status', ['user_id', 'status']]
    ]);
    createStore(db, 'applicationEvents', 'id', [
      ['user_id', 'user_id'],
      ['application_id', 'application_id']
    ]);
    createStore(db, 'meta', 'key');
  }
  if (oldVersion < 2) {
    createStore(db, 'payroll_entries', 'id', [
      ['user_id', 'user_id'],
      ['user_id_pay_date', ['user_id', 'pay_date']],
      ['employment_id', 'employment_id']
    ]);
  }
}

function createStore(db, name, keyPath, indexes = []) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, { keyPath });
  for (const [indexName, path] of indexes) store.createIndex(indexName, path, { unique: false });
}

function transactionCompletion(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(mapStorageError(tx.error, tx.mode));
    tx.onerror = () => reject(mapStorageError(tx.error, tx.mode));
  });
}

async function runExternalTransaction(db, stores, mode, operation) {
  const tx = db.transaction(stores, mode);
  const completed = transactionCompletion(tx);
  try {
    const result = await operation(tx);
    await completed;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* the transaction may already be complete */ }
    await completed.catch(() => {});
    throw mapStorageError(error, mode);
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function mapStorageError(error, mode = 'readonly') {
  if (error instanceof DataError) return error;
  const name = String(error?.name || '');
  if (name === 'QuotaExceededError') return new DataError('unknown', MESSAGES.quota, error);
  if (name === 'VersionError') return new DataError('unknown', MESSAGES.upgrade, error);
  if (['SecurityError', 'InvalidStateError', 'NotSupportedError', 'UnknownError'].includes(name)) {
    return new DataError('unknown', MESSAGES.unavailable, error);
  }
  return new DataError('unknown', mode === 'readonly' ? MESSAGES.read : MESSAGES.write, error);
}

function normalizeEmployment(row) {
  return { ...copy(row), hourly_rate: row.hourly_rate == null ? null : Number(row.hourly_rate) };
}

function normalizePayrollEntry(row) {
  return {
    ...copy(row),
    gross: row.gross == null ? null : Number(row.gross),
    deductions: Number(row.deductions),
    net: Number(row.net)
  };
}

function normalizePayrollEntryValues(values) {
  const normalized = { ...values };
  for (const key of ['gross', 'deductions', 'net']) {
    if (key in normalized) normalized[key] = normalizePayrollAmount(normalized[key]);
  }
  return normalized;
}

function validatePayrollLimit(limit) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new DataError('validation', 'Payroll entry limit must be a whole number of zero or more.');
  }
}

function normalizeShift(row) {
  const normalized = {
    ...copy(row),
    time_in: normalizeTimestamp(row.time_in),
    time_out: normalizeTimestamp(row.time_out)
  };
  return { ...normalized, worked_minutes: computeWorkedMinutes(normalized) };
}

function normalizeApplication(row) {
  return { ...copy(row), updated_at: normalizeTimestamp(row.updated_at) };
}

function normalizeApplicationEvent(row) {
  return { ...copy(row), event_date: normalizeTimestamp(row.event_date) };
}

function normalizeShiftValues(values) {
  const normalized = { ...values };
  if ('time_in' in normalized) normalized.time_in = normalizeTimestamp(normalized.time_in);
  if ('time_out' in normalized) normalized.time_out = normalizeTimestamp(normalized.time_out);
  if ('break_minutes' in normalized) normalized.break_minutes = Number(normalized.break_minutes);
  return normalized;
}

function normalizeEventValues(values) {
  const normalized = { ...values };
  if ('event_date' in normalized) normalized.event_date = normalizeTimestamp(normalized.event_date);
  return normalized;
}

function withoutIdentity(input = {}) {
  const { id, user_id, created_at, updated_at, worked_minutes, ...values } = input;
  return values;
}

function withoutDerived(input = {}) {
  const { worked_minutes, ...values } = withoutIdentity(input);
  return values;
}

function copy(value) {
  return { ...value };
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new DataError('unknown', 'This device cannot create a secure record id.');
}

function missingMessage(kind) {
  if (kind === 'employment') return 'We could not update this job. Refresh the page and try again.';
  if (kind === 'shift') return 'We could not find this shift to update. Refresh the page and try again.';
  if (kind === 'application') return 'We could not find this application to update. Refresh the page and try again.';
  if (kind === 'payroll_entry') return 'We could not find this payday to update. Refresh the page and try again.';
  return 'We could not find this timeline event to update. Refresh the page and try again.';
}
