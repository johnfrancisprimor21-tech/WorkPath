import {
  compareApplicationEvents,
  compareApplications,
  compareEmployments,
  compareShifts
} from './contract.js';
import { DataError } from './errors.js';
import { computeWorkedMinutes } from '../shared/hours.js';

const USER_MODES = new Set(['employed', 'job_seeker']);
const PAY_FREQUENCIES = new Set(['weekly', 'biweekly', 'semi_monthly', 'monthly']);
const DAY_TYPES = new Set(['duty', 'off', 'leave', 'sick', 'holiday']);
const APPLICATION_STATUSES = new Set(['pending', 'interview', 'offer', 'rejected', 'no_response']);

export function createMemoryStore() {
  return {
    profiles: [],
    employments: [],
    shifts: [],
    applications: [],
    applicationEvents: []
  };
}

/** Create an isolated or shared-store in-memory repository for tests. */
export function createMemoryRepo({ getUserId, store = createMemoryStore() } = {}) {
  function userId() {
    const id = getUserId?.();
    if (!id) throw new DataError('permission', 'Your session ended. Please sign in again.');
    if (!store.profiles.some((profile) => profile.id === id)) {
      store.profiles.push({
        id,
        display_name: null,
        mode: 'job_seeker',
        currency: null,
        pay_frequency: null,
        timezone: null,
        onboarded: false,
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
    checkApplicationReference(values.application_id);
    validateApplicationEvent(values);
    const row = {
      notes: null,
      ...values,
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
        if (candidate.mode != null && !USER_MODES.has(candidate.mode)) {
          throw new DataError('validation', 'Choose one of the available work modes.');
        }
        if (candidate.pay_frequency != null && !PAY_FREQUENCIES.has(candidate.pay_frequency)) {
          throw new DataError('validation', 'Check the required profile details and try again.');
        }
        if (candidate.currency != null && !/^[A-Z]{3}$/.test(candidate.currency)) {
          throw new DataError('validation', 'Choose a valid three-letter currency code.');
        }
        if (candidate.onboarded && (!candidate.currency || !candidate.timezone)) {
          throw new DataError('validation', 'Choose both a currency and a time zone before finishing setup.');
        }
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
        if (!String(values.employer_name || '').trim()) {
          throw new DataError('validation', 'Employer name is required.');
        }
        validateRate(values.hourly_rate);
        const row = {
          job_title: null,
          hourly_rate: null,
          start_date: null,
          end_date: null,
          is_current: true,
          ...values,
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
        if (!String(candidate.employer_name || '').trim()) {
          throw new DataError('validation', 'Employer name is required.');
        }
        validateRate(candidate.hourly_rate);
        if (candidate.start_date && candidate.end_date && candidate.end_date < candidate.start_date) {
          throw new DataError('validation', 'Check the job dates and hourly rate, then try again.');
        }
        Object.assign(row, values);
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
        const row = {
          employment_id: null,
          day_type: 'duty',
          time_in: null,
          time_out: null,
          break_minutes: 0,
          is_overtime: false,
          notes: null,
          ...values,
          id: newId(),
          user_id: owner
        };
        validateShift(row);
        checkEmploymentReference(row.employment_id);
        store.shifts.push(row);
        return normalizeShift(row);
      },
      async update(id, input) {
        const row = ownRecord(store.shifts, id, 'shift');
        const values = withoutDerived(input);
        const candidate = { ...row, ...values };
        validateShift(candidate);
        checkEmploymentReference(candidate.employment_id);
        Object.assign(row, values);
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
          source: null,
          job_url: null,
          location: null,
          status: 'pending',
          contact_name: null,
          contact_email: null,
          notes: null,
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
        if (!APPLICATION_STATUSES.has(newStatus)) throw new DataError('validation', 'Choose a valid application status.');
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
        checkApplicationReference(candidate.application_id);
        validateApplicationEvent(candidate);
        Object.assign(row, values);
        return copy(row);
      },
      async remove(id) {
        const owner = userId();
        const index = store.applicationEvents.findIndex((item) => item.id === id && item.user_id === owner);
        if (index >= 0) store.applicationEvents.splice(index, 1);
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

function validateRate(rate) {
  if (rate == null || rate === '') return;
  const value = Number(rate);
  if (!Number.isFinite(value) || value < 0 || value > 99999999.99) {
    throw new DataError('validation', 'Hourly rate is too large. Enter a smaller amount.');
  }
}

function validateShift(shift) {
  if (!shift.work_date) throw new DataError('validation', 'Add the required shift details and try again.');
  if (!DAY_TYPES.has(shift.day_type)) throw new DataError('validation', 'Check the shift times, day type, and break length.');
  if (!Number.isInteger(Number(shift.break_minutes)) || Number(shift.break_minutes) < 0) {
    throw new DataError('validation', 'Check the shift times, day type, and break length.');
  }
  if (shift.time_in && shift.time_out && Date.parse(shift.time_out) <= Date.parse(shift.time_in)) {
    throw new DataError('validation', 'Check the shift times, day type, and break length.');
  }
}

function validateApplication(application) {
  if (!application.company || !application.position || !application.date_applied) {
    throw new DataError('validation', 'Company, position, and date applied are required.');
  }
  if (!APPLICATION_STATUSES.has(application.status)) throw new DataError('validation', 'Choose a valid application status.');
}

function validateApplicationEvent(event) {
  if (!event.application_id || !event.event_type || !event.event_date || !Number.isFinite(Date.parse(event.event_date))) {
    throw new DataError('validation', 'Add the required event details and try again.');
  }
}

function validateDateRange(fromDate, toDate) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(String(fromDate)) || !datePattern.test(String(toDate)) || fromDate > toDate) {
    throw new DataError('validation', 'Choose a valid inclusive date range.');
  }
}

function missingMessage(kind) {
  if (kind === 'employment') return 'We could not update this job. Refresh the page and try again.';
  if (kind === 'shift') return 'We could not find this shift to update. Refresh the page and try again.';
  if (kind === 'application') return 'We could not find this application to update. Refresh the page and try again.';
  return 'We could not find this timeline event to update. Refresh the page and try again.';
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new DataError('unknown', 'This device cannot create a secure record id.');
}
