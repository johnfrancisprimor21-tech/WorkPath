import { normalizeTimestamp } from '../data/normalize-timestamp.js';
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
  validateEmployment,
  validatePayrollEntry,
  validateProfile,
  validateShift
} from '../data/validation.js';
import { DataError } from '../data/errors.js';

export const BACKUP_APP = 'workpath';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_LISTS = Object.freeze([
  'employments', 'shifts', 'payrollEntries', 'applications', 'applicationEvents'
]);
export const BACKUP_RECORD_LIMIT = 20_000;

const FIELDS = Object.freeze({
  employments: ['id', 'employer_name', 'job_title', 'hourly_rate', 'start_date', 'end_date', 'is_current'],
  shifts: ['id', 'employment_id', 'work_date', 'day_type', 'time_in', 'time_out', 'break_minutes', 'is_overtime', 'notes'],
  payrollEntries: ['id', 'employment_id', 'pay_date', 'period_start', 'period_end', 'gross', 'deductions', 'net', 'notes'],
  applications: ['id', 'company', 'position', 'source', 'job_url', 'location', 'date_applied', 'status', 'contact_name', 'contact_email', 'notes'],
  applicationEvents: ['id', 'application_id', 'event_type', 'event_date', 'notes']
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Build a privacy-filtered backup. Database identity and managed fields never leave the app. */
export function buildBackup({
  profile,
  employments = [],
  shifts = [],
  payrollEntries = [],
  applications = [],
  applicationEvents = [],
  source,
  exportedAt = new Date().toISOString()
}) {
  if (source !== 'local' && source !== 'account') {
    throw new DataError('validation', 'Choose a valid backup source.');
  }
  return {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: normalizeTimestamp(exportedAt),
    source,
    profile: Object.fromEntries(['display_name', 'mode', 'currency', 'pay_frequency', 'timezone']
      .map((key) => [key, profile?.[key] ?? null])),
    employments: copyFields(employments, FIELDS.employments),
    shifts: copyFields(shifts, FIELDS.shifts),
    payrollEntries: copyFields(payrollEntries, FIELDS.payrollEntries),
    applications: copyFields(applications, FIELDS.applications),
    applicationEvents: copyFields(applicationEvents, FIELDS.applicationEvents)
  };
}

/** Parse, normalize, validate, and relationship-check all supported backup rows. */
export function parseBackup(text) {
  const errors = [];
  const warnings = [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failure('This file is not valid JSON.');
  }
  if (!isObject(parsed)) return failure('This is not a Workpath backup.');
  if (parsed.app !== BACKUP_APP) return failure('This file is not a Workpath backup.');
  if (parsed.formatVersion === undefined || parsed.formatVersion === null) {
    return failure('This backup is missing its format version.');
  }
  if (Number(parsed.formatVersion) > BACKUP_FORMAT_VERSION) {
    return failure('This backup was made by a newer version of Workpath.');
  }
  if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
    return failure('This backup format version is not supported.');
  }
  const exportedAt = normalizeTimestampOrNull(parsed.exportedAt);
  if (!exportedAt) errors.push(issue('backup', 0, 'The backup export date is invalid.'));
  if (parsed.source !== 'local' && parsed.source !== 'account') {
    errors.push(issue('backup', 0, 'The backup source is invalid.'));
  }
  const profile = parseProfile(parsed.profile, errors);

  const data = {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
    source: parsed.source === 'local' || parsed.source === 'account' ? parsed.source : 'account',
    profile,
    employments: [],
    shifts: [],
    payrollEntries: [],
    applications: [],
    applicationEvents: []
  };
  const seenIds = Object.fromEntries(BACKUP_LISTS.map((list) => [list, new Set()]));
  for (const list of BACKUP_LISTS) {
    const rows = parsed[list];
    if (!Array.isArray(rows)) {
      errors.push(issue(list, 0, 'This section must be a list of records.'));
      continue;
    }
    if (rows.length > BACKUP_RECORD_LIMIT) {
      errors.push(issue(list, 0, 'This section has more than ' + BACKUP_RECORD_LIMIT.toLocaleString() + ' records.'));
      continue;
    }
    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = index + 1;
      const rowErrors = [];
      let normalized;
      try {
        normalized = normalizeAndValidateRecord(list, rows[index]);
      } catch (error) {
        rowErrors.push(error.message || 'Check this record and try again.');
        normalized = pickFields(rows[index], FIELDS[list]);
      }
      if (!normalized?.id || !UUID_PATTERN.test(normalized.id)) {
        if (!rowErrors.length) rowErrors.push('The record id is not a valid UUID.');
      } else if (seenIds[list].has(normalized.id)) {
        rowErrors.push('This record id appears more than once in the backup.');
      }
      if (normalized?.id) seenIds[list].add(normalized.id);
      for (const message of rowErrors) errors.push(issue(list, rowNumber, message));
      if (!rowErrors.length) data[list].push(normalized);
    }
  }

  const employmentIds = new Set(data.employments.map((row) => row.id));
  for (const list of ['shifts', 'payrollEntries']) {
    const sourceRows = Array.isArray(parsed[list]) ? parsed[list] : [];
    for (let index = 0; index < sourceRows.length && index < BACKUP_RECORD_LIMIT; index += 1) {
      const raw = sourceRows[index];
      if (!isObject(raw) || raw.employment_id == null || employmentIds.has(raw.employment_id)) continue;
      errors.push(issue(list, index + 1, 'This record refers to a job that is missing from the backup.'));
      data[list] = data[list].filter((row) => row.id !== raw.id);
    }
  }
  const applicationIds = new Set(data.applications.map((row) => row.id));
  const sourceEvents = Array.isArray(parsed.applicationEvents) ? parsed.applicationEvents : [];
  for (let index = 0; index < sourceEvents.length && index < BACKUP_RECORD_LIMIT; index += 1) {
    const raw = sourceEvents[index];
    if (!isObject(raw) || applicationIds.has(raw.application_id)) continue;
    errors.push(issue('applicationEvents', index + 1, 'This event refers to an application that is missing from the backup.'));
    data.applicationEvents = data.applicationEvents.filter((row) => row.id !== raw.id);
  }

  if (hasUnknownFields(parsed)) warnings.push('Unknown fields were ignored.');
  return { ok: errors.length === 0, data, errors, warnings };

  function failure(message) {
    return { ok: false, data: null, errors: [issue('backup', 0, message)], warnings: [] };
  }
}

export function backupFields() {
  return {
    profile: ['display_name', 'mode', 'currency', 'pay_frequency', 'timezone'],
    ...Object.fromEntries(BACKUP_LISTS.map((list) => [list, [...FIELDS[list]]]))
  };
}

function parseProfile(value, errors) {
  if (!isObject(value)) {
    errors.push(issue('profile', 0, 'The profile settings are missing or invalid.'));
    return { ...PROFILE_DEFAULTS };
  }
  if (!Object.hasOwn(value, 'mode')) {
    errors.push(issue('profile', 0, 'Choose one of the available work modes.'));
  }
  const profile = Object.fromEntries(['display_name', 'mode', 'currency', 'pay_frequency', 'timezone']
    .map((key) => [key, value[key] ?? PROFILE_DEFAULTS[key]]));
  try {
    validateProfile({ ...PROFILE_DEFAULTS, ...profile, onboarded: false });
  } catch (error) {
    errors.push(issue('profile', 0, error.message));
  }
  return profile;
}

function normalizeAndValidateRecord(list, input) {
  if (!isObject(input)) throw new DataError('validation', 'This record must be an object.');
  const value = pickFields(input, FIELDS[list]);
  switch (list) {
    case 'employments': {
      const row = { ...EMPLOYMENT_DEFAULTS, ...value };
      ensureOptionalText(row, ['job_title'], 'Check the job details and try again.');
      if (row.hourly_rate != null) row.hourly_rate = normalizeHourlyRate(row.hourly_rate);
      validateEmployment(row);
      return row;
    }
    case 'shifts': {
      const row = { ...SHIFT_DEFAULTS, ...value };
      ensureOptionalText(row, ['notes'], 'Check the shift times, day type, and break length.');
      for (const key of ['time_in', 'time_out']) if (row[key] != null) row[key] = normalizeRecordTimestamp(row[key]);
      validateShift(row);
      row.break_minutes = Number(row.break_minutes);
      return row;
    }
    case 'payrollEntries': {
      const row = { ...PAYROLL_ENTRY_DEFAULTS, ...value };
      ensureOptionalText(row, ['notes'], 'Check the payday details and try again.');
      for (const key of ['gross', 'deductions', 'net']) {
        if (row[key] != null) row[key] = normalizePayrollAmount(row[key]);
      }
      validatePayrollEntry(row);
      return row;
    }
    case 'applications': {
      const row = { ...APPLICATION_DEFAULTS, ...value };
      ensureOptionalText(row, ['source', 'job_url', 'location', 'contact_name', 'contact_email', 'notes'],
        'Check the application details and try again.');
      validateApplication(row);
      return row;
    }
    case 'applicationEvents': {
      const row = { ...value, notes: value.notes ?? null };
      ensureOptionalText(row, ['notes'], 'Check the timeline event details and try again.');
      row.event_date = normalizeRecordTimestamp(row.event_date);
      validateApplicationEvent(row);
      return row;
    }
    default:
      throw new DataError('validation', 'This record type is not supported.');
  }
}

function ensureOptionalText(record, fields, message) {
  for (const field of fields) {
    if (record[field] != null && typeof record[field] !== 'string') {
      throw new DataError('validation', message);
    }
  }
}

function normalizeRecordTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new DataError('validation', 'Enter a valid date and time in this record.');
  }
  return normalizeTimestamp(value);
}

function copyFields(rows, fields) {
  return rows.map((row) => Object.fromEntries(fields.map((key) => [key, row?.[key] ?? null])));
}

function pickFields(value, fields) {
  if (!isObject(value)) return {};
  return Object.fromEntries(fields.filter((key) => key in value).map((key) => [key, value[key]]));
}

function hasUnknownFields(backup) {
  const allowedRoot = new Set(['app', 'formatVersion', 'exportedAt', 'source', 'profile', ...BACKUP_LISTS]);
  if (Object.keys(backup).some((key) => !allowedRoot.has(key))) return true;
  const fields = backupFields();
  if (isObject(backup.profile) && Object.keys(backup.profile).some((key) => !fields.profile.includes(key))) return true;
  return BACKUP_LISTS.some((list) => Array.isArray(backup[list])
    && backup[list].some((row) => isObject(row) && Object.keys(row).some((key) => !FIELDS[list].includes(key))));
}

function normalizeTimestampOrNull(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  try { return normalizeTimestamp(value); } catch { return null; }
}

function issue(list, row, message) {
  return { list, row, message };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
