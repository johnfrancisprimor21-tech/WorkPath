import {
  compareApplicationEvents,
  compareApplications,
  compareEmployments,
  comparePayrollEntries,
  compareShifts
} from './contract.js';
import { DataError } from './errors.js';
import { computeWorkedMinutes } from '../shared/hours.js';
import { normalizeTimestamp } from './normalize-timestamp.js';
import {
  APPLICATION_DEFAULTS,
  EMPLOYMENT_DEFAULTS,
  PROFILE_DEFAULTS,
  PAYROLL_ENTRY_DEFAULTS,
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

export function createMemoryStore() {
  return {
    profiles: [],
    employments: [],
    shifts: [],
    applications: [],
    applicationEvents: [],
    payrollEntries: []
  };
}

/** Create an isolated or shared-store in-memory repository for tests. */
export function createMemoryRepo({ getUserId, store = createMemoryStore() } = {}) {
  function userId() {
    const id = getUserId?.();
    if (!id) throw new DataError('permission', 'Your session ended. Please sign in again.');
    if (!store.profiles.some((profile) => profile.id === id)) {
      store.profiles.push({
        ...PROFILE_DEFAULTS,
        id,
        created_at: new Date().toISOString()
      });
    }
    return id;
  }

  function ownRecord(collection, id, kind, message) {
    const owner = userId();
    const record = collection.find((item) => item.id === id && item.user_id === owner);
    if (!record) throw new DataError('not_found', message || missingMessage(kind));
    return record;
  }

  function checkEmploymentReference(employmentId) {
    if (!employmentId) return;
    const owner = userId();
    if (!store.employments.some((item) => item.id === employmentId && item.user_id === owner)) {
      throw new DataError('permission', 'Choose one of your jobs or select no employer.');
    }
  }

  function checkApplicationReference(applicationId) {
    const owner = userId();
    if (store.applications.some((item) => item.id === applicationId && item.user_id === owner)) return;
    const message = store.applications.some((item) => item.id === applicationId)
      ? 'You can only change events on your own applications.'
      : 'This application is no longer available.';
    throw new DataError(store.applications.some((item) => item.id === applicationId) ? 'permission' : 'not_found', message);
  }

  async function createApplicationEvent(input) {
    const owner = userId();
    const values = withoutIdentity(input);
    validateApplicationEvent(values);
    checkApplicationReference(values.application_id);
    const candidate = normalizeEventValues(values);
    const row = {
      notes: null,
      ...candidate,
      id: newId(),
      user_id: owner
    };
    store.applicationEvents.push(row);
    return copy(row);
  }

  return {
    profile: {
      async get() {
        const owner = userId();
        const row = store.profiles.find((item) => item.id === owner);
        if (!row) throw new DataError('not_found', 'We could not find your profile. Sign out and sign in again, or contact support.');
        return copy(row);
      },
      async update(values) {
        const owner = userId();
        const row = store.profiles.find((item) => item.id === owner);
        if (!row) throw new DataError('not_found', 'We could not find your profile to update. Please sign out and sign in again.');
        const updates = withoutIdentity(values);
        const candidate = { ...row, ...updates };
        validateProfile(candidate);
        Object.assign(row, updates);
        return copy(row);
      }
    },
    employments: {
      async list() {
        const owner = userId();
        return store.employments.filter((item) => item.user_id === owner).slice().sort(compareEmployments)
          .map(normalizeEmployment);
      },
      async create(input) {
        const owner = userId();
        const values = withoutIdentity(input);
        const candidate = { ...EMPLOYMENT_DEFAULTS, ...values };
        validateEmployment(candidate);
        candidate.hourly_rate = normalizeHourlyRate(candidate.hourly_rate);
        const row = {
          ...candidate,
          id: newId(),
          user_id: owner
        };
        store.employments.push(row);
        return normalizeEmployment(row);
      },
      async update(id, input) {
        const row = ownRecord(store.employments, id, 'employment');
        const values = withoutIdentity(input);
        const candidate = { ...row, ...values };
        validateEmployment(candidate);
        Object.assign(row, values, values.hourly_rate === undefined ? {} : { hourly_rate: normalizeHourlyRate(values.hourly_rate) });
        return normalizeEmployment(row);
      },
      async remove(id) {
        const owner = userId();
        const index = store.employments.findIndex((item) => item.id === id && item.user_id === owner);
        if (index < 0) return;
        store.employments.splice(index, 1);
        for (const shift of store.shifts) {
          if (shift.user_id === owner && shift.employment_id === id) shift.employment_id = null;
        }
        for (const entry of store.payrollEntries) {
          if (entry.user_id === owner && entry.employment_id === id) entry.employment_id = null;
        }
      }
    },
    shifts: {
      async listBetween(fromDate, toDate) {
        validateDateRange(fromDate, toDate);
        const owner = userId();
        return store.shifts.filter((item) => item.user_id === owner && item.work_date >= fromDate && item.work_date <= toDate)
          .slice().sort(compareShifts).map(normalizeShift);
      },
      async create(input) {
        const owner = userId();
        const values = withoutDerived(input);
        const candidate = { ...SHIFT_DEFAULTS, ...values };
        validateShift(candidate);
        checkEmploymentReference(candidate.employment_id);
        const row = { ...normalizeShiftValues(candidate), id: newId(), user_id: owner };
        store.shifts.push(row);
        return normalizeShift(row);
      },
      async update(id, input) {
        const row = ownRecord(store.shifts, id, 'shift');
        const values = withoutDerived(input);
        const candidate = { ...row, ...values };
        validateShift(candidate);
        checkEmploymentReference(candidate.employment_id);
        const normalizedValues = normalizeShiftValues(values);
        Object.assign(row, normalizedValues);
        return normalizeShift(row);
      },
      async remove(id) {
        const owner = userId();
        const index = store.shifts.findIndex((item) => item.id === id && item.user_id === owner);
        if (index >= 0) store.shifts.splice(index, 1);
      }
    },
    applications: {
      async list({ limit } = {}) {
        const owner = userId();
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
          throw new DataError('validation', 'Application limit must be a whole number of zero or more.');
        }
        let rows = store.applications.filter((item) => item.user_id === owner).slice().sort(compareApplications);
        if (limit !== undefined) rows = rows.slice(0, limit);
        return rows.map(copy);
      },
      async create(input) {
        const owner = userId();
        const values = withoutIdentity(input);
        const row = {
          ...APPLICATION_DEFAULTS,
          ...values,
          id: newId(),
          user_id: owner,
          updated_at: new Date().toISOString()
        };
        validateApplication(row);
        store.applications.push(row);
        return copy(row);
      },
      async update(id, input) {
        const row = ownRecord(store.applications, id, 'application', 'We could not find this application to update. Refresh the page and try again.');
        const values = withoutIdentity(input);
        const candidate = { ...row, ...values };
        validateApplication(candidate);
        Object.assign(row, values, { updated_at: new Date().toISOString() });
        return copy(row);
      },
      async remove(id) {
        const owner = userId();
        const index = store.applications.findIndex((item) => item.id === id && item.user_id === owner);
        if (index < 0) return;
        store.applications.splice(index, 1);
        store.applicationEvents = store.applicationEvents.filter((event) => !(event.user_id === owner && event.application_id === id));
      },
      async changeStatus(id, newStatus) {
        const current = ownRecord(store.applications, id, 'application', 'We could not find this application to update. Refresh the page and try again.');
        validateApplication({ ...current, status: newStatus });
        if (current.status === newStatus) return { application: copy(current), warning: false };
        const previousStatus = current.status;
        const values = { status: newStatus };
        validateApplication({ ...current, ...values });
        Object.assign(current, values, { updated_at: new Date().toISOString() });
        const application = copy(current);
        let warning = false;
        try {
          await createApplicationEvent({
            application_id: id,
            event_type: 'status_changed',
            event_date: new Date().toISOString(),
            notes: previousStatus + ' -> ' + newStatus
          });
        } catch {
          warning = true;
        }
        return { application, warning };
      }
    },
    applicationEvents: {
      async listForApplication(applicationId) {
        const owner = userId();
        return store.applicationEvents.filter((item) => item.user_id === owner && item.application_id === applicationId)
          .slice().sort(compareApplicationEvents).map(copy);
      },
      create: createApplicationEvent,
      async update(id, input) {
        const row = ownRecord(store.applicationEvents, id, 'application_event', 'We could not find this timeline event to update. Refresh the page and try again.');
        const values = withoutIdentity(input);
        const candidate = { ...row, ...values };
        validateApplicationEvent(candidate);
        checkApplicationReference(candidate.application_id);
        const normalizedValues = normalizeEventValues(values);
        Object.assign(row, normalizedValues);
        return copy(row);
      },
      async remove(id) {
        const owner = userId();
        const index = store.applicationEvents.findIndex((item) => item.id === id && item.user_id === owner);
        if (index >= 0) store.applicationEvents.splice(index, 1);
      }
    },
    payrollEntries: {
      async list({ limit } = {}) {
        const owner = userId();
        validatePayrollLimit(limit);
        let rows = store.payrollEntries.filter((item) => item.user_id === owner).slice().sort(comparePayrollEntries);
        if (limit !== undefined) rows = rows.slice(0, limit);
        return rows.map(normalizePayrollEntry);
      },
      async listBetween(fromDate, toDate) {
        validateDateRange(fromDate, toDate);
        const owner = userId();
        return store.payrollEntries.filter((item) => item.user_id === owner && item.pay_date >= fromDate && item.pay_date <= toDate)
          .slice().sort(comparePayrollEntries).map(normalizePayrollEntry);
      },
      async create(input) {
        const owner = userId();
        const candidate = { ...PAYROLL_ENTRY_DEFAULTS, ...withoutIdentity(input) };
        validatePayrollEntry(candidate);
        checkEmploymentReference(candidate.employment_id);
        const row = { ...normalizePayrollEntryValues(candidate), id: newId(), user_id: owner };
        store.payrollEntries.push(row);
        return normalizePayrollEntry(row);
      },
      async update(id, input) {
        const row = ownRecord(store.payrollEntries, id, 'payroll_entry');
        const updates = withoutIdentity(input);
        const candidate = { ...row, ...updates };
        validatePayrollEntry(candidate);
        checkEmploymentReference(candidate.employment_id);
        Object.assign(row, normalizePayrollEntryValues(updates));
        return normalizePayrollEntry(row);
      },
      async remove(id) {
        const owner = userId();
        const index = store.payrollEntries.findIndex((item) => item.id === id && item.user_id === owner);
        if (index >= 0) store.payrollEntries.splice(index, 1);
      }
    }
  };
}

function copy(value) {
  return { ...value };
}

function normalizeEmployment(row) {
  return { ...copy(row), hourly_rate: row.hourly_rate === null ? null : Number(row.hourly_rate) };
}

function normalizePayrollEntry(row) {
  return { ...copy(row), gross: row.gross == null ? null : Number(row.gross), deductions: Number(row.deductions), net: Number(row.net) };
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
  return { ...copy(row), worked_minutes: computeWorkedMinutes(row) };
}

function withoutIdentity(input = {}) {
  const { id, user_id, created_at, updated_at, ...values } = input;
  return values;
}

function withoutDerived(input = {}) {
  const { worked_minutes, ...values } = withoutIdentity(input);
  return values;
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

function missingMessage(kind) {
  if (kind === 'employment') return 'We could not update this job. Refresh the page and try again.';
  if (kind === 'shift') return 'We could not find this shift to update. Refresh the page and try again.';
  if (kind === 'application') return 'We could not find this application to update. Refresh the page and try again.';
  if (kind === 'payroll_entry') return 'We could not find this payday to update. Refresh the page and try again.';
  return 'We could not find this timeline event to update. Refresh the page and try again.';
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new DataError('unknown', 'This device cannot create a secure record id.');
}
