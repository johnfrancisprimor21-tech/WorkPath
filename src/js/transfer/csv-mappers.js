import {
  APPLICATION_DEFAULTS,
  EMPLOYMENT_DEFAULTS,
  PAYROLL_ENTRY_DEFAULTS,
  SHIFT_DEFAULTS,
  isDateOnly,
  validateApplication,
  validateEmployment,
  validatePayrollEntry,
  validateShift
} from '../data/validation.js';
import { addCalendarDay, localDateTimeToUtc, utcToLocalDateTime } from '../shared/time.js';
import { restoreCsvText, serializeCsv } from './csv.js';

export const CSV_FORMATS = Object.freeze({
  employments: {
    label: 'Jobs',
    slug: 'jobs',
    headers: ['employer_name', 'job_title', 'hourly_rate', 'start_date', 'end_date', 'is_current'],
    required: ['employer_name'],
    textColumns: ['employer_name', 'job_title'],
    help: 'Example: Acme,Support specialist,25.50,2026-01-01,,yes. Dates use YYYY-MM-DD; hourly rate is a plain number with up to 2 decimals; booleans use yes/no, true/false, or 1/0.'
  },
  shifts: {
    label: 'Shifts',
    slug: 'shifts',
    headers: ['work_date', 'employer_name', 'job_title', 'day_type', 'time_in', 'time_out', 'break_minutes', 'is_overtime', 'notes', 'timezone', 'worked_hours'],
    required: ['work_date', 'day_type'],
    textColumns: ['employer_name', 'job_title', 'day_type', 'notes', 'timezone'],
    help: 'Example: 2026-10-15,Acme,Support specialist,duty,22:00,06:00,60,yes,Overnight,Asia/Manila,7. Day types: duty, off, leave, sick, holiday. Dates use YYYY-MM-DD; times use 24-hour HH:MM; booleans use yes/no, true/false, or 1/0. Non-duty days have no times; worked_hours is ignored on import.'
  },
  payrollEntries: {
    label: 'Paydays',
    slug: 'paydays',
    headers: ['pay_date', 'employer_name', 'job_title', 'period_start', 'period_end', 'gross', 'deductions', 'net', 'notes'],
    required: ['pay_date', 'net'],
    textColumns: ['employer_name', 'job_title', 'notes'],
    help: 'Example: 2026-10-15,Acme,Support specialist,2026-10-01,2026-10-14,1000.00,50.00,950.00,October pay. Dates use YYYY-MM-DD; money uses plain numbers with an optional dot and up to 2 decimals. Amounts are not converted.'
  },
  applications: {
    label: 'Applications',
    slug: 'applications',
    headers: ['company', 'position', 'source', 'job_url', 'location', 'date_applied', 'status', 'contact_name', 'contact_email', 'notes'],
    required: ['company', 'position', 'date_applied', 'status'],
    textColumns: ['company', 'position', 'source', 'job_url', 'location', 'status', 'contact_name', 'contact_email', 'notes'],
    help: 'Example: Acme,Analyst,Company site,https://example.test/jobs/1,Manila,2026-10-15,pending,Alex,alex@example.test,Follow up next week. Dates use YYYY-MM-DD; statuses are pending, interview, offer, rejected, or no_response. Job links must use http or https; contact email must be a valid email address.'
  },
  applicationEvents: {
    label: 'Timeline events',
    slug: 'timeline-events',
    headers: ['company', 'position', 'date_applied', 'event_type', 'event_date', 'event_time', 'notes'],
    required: [],
    textColumns: ['company', 'position', 'event_type', 'notes'],
    help: 'Timeline events can be exported for reference, but cannot be imported.'
  }
});

const IMPORT_LISTS = ['employments', 'shifts', 'payrollEntries', 'applications'];
const BACKUP_LISTS = ['employments', 'shifts', 'payrollEntries', 'applications', 'applicationEvents'];
const LIST_TO_DATA = { employments: 'employments', shifts: 'shifts', payrollEntries: 'payrollEntries', applications: 'applications' };
const DAY_TYPES = ['duty', 'off', 'leave', 'sick', 'holiday'];
const APPLICATION_STATUSES = ['pending', 'interview', 'offer', 'rejected', 'no_response'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONEY_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;
const MAX_PAYROLL_MONEY = 9_999_999_999.99;
const MAX_HOURLY_RATE = 99_999_999.99;

export function detectCsvList(headers) {
  const names = new Set(headers.map(normalizeHeader));
  const scored = IMPORT_LISTS.map((list) => ({
    list,
    score: CSV_FORMATS[list].headers.filter((name) => names.has(name)).length
  })).filter((candidate) => candidate.score > 0);
  if (!scored.length) return null;
  const highest = Math.max(...scored.map((candidate) => candidate.score));
  const winners = scored.filter((candidate) => candidate.score === highest);
  return winners.length === 1 ? winners[0].list : null;
}

export function exportCsv(list, data, profile = {}) {
  const format = CSV_FORMATS[list];
  if (!format) throw new Error('Choose a supported CSV list.');
  const timeZone = validTimeZone(profile.timezone) ? profile.timezone : 'UTC';
  const employmentById = new Map((data.employments || []).map((record) => [record.id, record]));
  const applicationById = new Map((data.applications || []).map((record) => [record.id, record]));
  const rows = (data[list] || []).map((record) => {
    const employment = employmentById.get(record.employment_id);
    if (list === 'employments') {
      return [record.employer_name, record.job_title, moneyText(record.hourly_rate), record.start_date,
        record.end_date, yesNo(record.is_current)];
    }
    if (list === 'shifts') {
      return [record.work_date, employment?.employer_name, employment?.job_title, record.day_type,
        localTime(record.time_in, timeZone), localTime(record.time_out, timeZone), record.break_minutes,
        yesNo(record.is_overtime), record.notes, timeZone,
        (Number(record.worked_minutes || 0) / 60).toFixed(2)];
    }
    if (list === 'payrollEntries') {
      return [record.pay_date, employment?.employer_name, employment?.job_title, record.period_start,
        record.period_end, moneyText(record.gross), moneyText(record.deductions), moneyText(record.net), record.notes];
    }
    if (list === 'applications') {
      return [record.company, record.position, record.source, record.job_url, record.location,
        record.date_applied, record.status, record.contact_name, record.contact_email, record.notes];
    }
    const application = applicationById.get(record.application_id);
    const local = record.event_date ? utcToLocalDateTime(record.event_date, timeZone) : { date: '', time: '' };
    return [application?.company, application?.position, application?.date_applied,
      record.event_type, local.date, local.time, record.notes];
  });
  return serializeCsv(format.headers, rows, { textColumns: format.textColumns });
}

/** Convert parsed CSV rows into the shared backup/importer shape. */
export function mapCsvImport(csv, list, { profile = {}, employments = [] } = {}) {
  if (!IMPORT_LISTS.includes(list)) throw new Error('Choose an importable CSV list.');
  const format = CSV_FORMATS[list];
  const dataList = LIST_TO_DATA[list];
  const data = {
    profile: {
      currency: profile.currency ?? null,
      pay_frequency: profile.pay_frequency ?? null,
      timezone: profile.timezone || 'UTC'
    },
    employments: [], shifts: [], payrollEntries: [], applications: [], applicationEvents: []
  };
  const errors = (csv.errors || []).map((error) => ({
    list: dataList,
    row: error.row,
    column: error.column || 'CSV row',
    message: error.message
  }));
  const warnings = [...(csv.warnings || [])];
  const sourceRows = Object.fromEntries(BACKUP_LISTS.map((name) => [name, []]));
  const employmentIdAliases = new Map();
  const headerIndexes = new Map();

  csv.headers.forEach((rawName, index) => {
    const name = normalizeHeader(rawName);
    if (headerIndexes.has(name)) {
      errors.push({ list: dataList, row: 1, column: rawName || 'header', message: `Duplicate column name: ${rawName || '(blank)'}.` });
    } else {
      headerIndexes.set(name, index);
    }
  });
  for (const required of format.required) {
    if (!headerIndexes.has(required)) {
      errors.push({ list: dataList, row: 1, column: required, message: `Required column is missing: ${required}.` });
    }
  }
  const recognized = new Set(format.headers);
  const unknown = csv.headers.filter((name) => !recognized.has(normalizeHeader(name)));
  if (unknown.length) warnings.push('Ignored columns: ' + unknown.join(', ') + '.');

  const warnedTimeZones = new Set();
  for (const record of csv.records) {
    const rowErrors = [];
    const read = (column, asText = false) => {
      const index = headerIndexes.get(column);
      if (index === undefined) return '';
      const value = record.values[index] ?? '';
      return asText ? restoreCsvText(value) : value;
    };
    let row;
    if (list === 'employments') {
      row = mapEmploymentRow(read, record.row, rowErrors);
    } else if (list === 'shifts') {
      row = mapShiftRow(read, record.row, rowErrors, {
        profileTimeZone: profile.timezone || 'UTC', employments, employmentIdAliases, warnedTimeZones,
        warnings
      });
    } else if (list === 'payrollEntries') {
      row = mapPayrollRow(read, record.row, rowErrors, { employments, employmentIdAliases });
    } else {
      row = mapApplicationRow(read, record.row, rowErrors);
    }
    if (rowErrors.length) {
      errors.push(...rowErrors.map((entry) => ({ list: dataList, ...entry })));
      continue;
    }
    row.id = globalThis.crypto.randomUUID();
    data[dataList].push(row);
    sourceRows[dataList].push(record.row);
  }

  warnings.push('Amounts are imported as written in your profile currency; no currency conversion is performed.');
  return { parsed: { data, errors, warnings, sourceRows }, employmentIdAliases };
}

function mapEmploymentRow(read, rowNumber, errors) {
  const employerName = read('employer_name', true);
  const jobTitle = nullable(read('job_title', true));
  const hourlyRate = parseMoney(read('hourly_rate'), rowNumber, 'hourly_rate', errors, { optional: true, max: MAX_HOURLY_RATE });
  const startDate = parseDate(read('start_date'), rowNumber, 'start_date', errors, false);
  const endDate = parseDate(read('end_date'), rowNumber, 'end_date', errors, false);
  const isCurrent = parseBoolean(read('is_current'), rowNumber, 'is_current', errors, true);
  const record = { employer_name: employerName, job_title: jobTitle, hourly_rate: hourlyRate,
    start_date: startDate, end_date: endDate, is_current: isCurrent };
  if (!employerName.trim()) addError(errors, rowNumber, 'employer_name', 'Employer name is required.');
  if (startDate && endDate && endDate < startDate) addError(errors, rowNumber, 'end_date', 'End date must not be before start date.');
  try { validateEmployment({ ...EMPLOYMENT_DEFAULTS, ...record }); }
  catch (error) { if (!errors.length) addError(errors, rowNumber, 'employer_name', error.message); }
  return record;
}

function mapShiftRow(read, rowNumber, errors, context) {
  const workDate = parseDate(read('work_date'), rowNumber, 'work_date', errors, true);
  const dayType = parseEnum(read('day_type', true), DAY_TYPES, rowNumber, 'day_type', errors, true);
  const timeInText = read('time_in');
  const timeOutText = read('time_out');
  const timeInValue = parseTime(timeInText, rowNumber, 'time_in', errors);
  const timeOutValue = parseTime(timeOutText, rowNumber, 'time_out', errors);
  const breakMinutes = parseInteger(read('break_minutes'), rowNumber, 'break_minutes', errors, 0);
  const isOvertime = parseBoolean(read('is_overtime'), rowNumber, 'is_overtime', errors, false);
  const notes = nullable(read('notes', true));
  const suppliedZone = read('timezone', true).trim();
  const timezone = suppliedZone || context.profileTimeZone;
  if (!validTimeZone(timezone)) {
    addError(errors, rowNumber, 'timezone', 'Enter a valid IANA time zone name.');
  } else if (timezone !== context.profileTimeZone && suppliedZone) {
    context.warnedTimeZones.add(timezone);
  }
  let timeIn = null;
  let timeOut = null;
  if (dayType !== 'duty') {
    if (timeInText.trim()) addError(errors, rowNumber, 'time_in', 'Non-duty days cannot include shift times.');
    if (timeOutText.trim()) addError(errors, rowNumber, 'time_out', 'Non-duty days cannot include shift times.');
  } else if (workDate && validTimeZone(timezone)) {
    try {
      if (timeInValue) timeIn = localDateTimeToUtc(workDate, timeInValue, timezone);
    } catch (error) { addError(errors, rowNumber, 'time_in', error.message); }
    try {
      if (timeOutValue) {
        const endDate = timeInValue && timeOutValue <= timeInValue ? addCalendarDay(workDate) : workDate;
        timeOut = localDateTimeToUtc(endDate, timeOutValue, timezone);
      }
    } catch (error) { addError(errors, rowNumber, 'time_out', error.message); }
  }
  const employmentId = resolveEmployment(read('employer_name', true), read('job_title', true),
    rowNumber, 'employer_name', errors, context.employments, context.employmentIdAliases);
  const record = { employment_id: employmentId, work_date: workDate, day_type: dayType,
    time_in: timeIn, time_out: timeOut, break_minutes: breakMinutes, is_overtime: isOvertime, notes };
  try { validateShift({ ...SHIFT_DEFAULTS, ...record }); }
  catch (error) { if (!errors.length) addError(errors, rowNumber, 'work_date', error.message); }
  for (const zone of context.warnedTimeZones) {
    const warning = `Shift times in ${zone} were converted to UTC; your profile time zone is ${context.profileTimeZone}.`;
    if (!context.warnings.includes(warning)) context.warnings.push(warning);
  }
  return record;
}

function mapPayrollRow(read, rowNumber, errors, context) {
  const payDate = parseDate(read('pay_date'), rowNumber, 'pay_date', errors, true);
  const periodStart = parseDate(read('period_start'), rowNumber, 'period_start', errors, false);
  const periodEnd = parseDate(read('period_end'), rowNumber, 'period_end', errors, false);
  const gross = parseMoney(read('gross'), rowNumber, 'gross', errors, { optional: true, max: MAX_PAYROLL_MONEY });
  const deductions = parseMoney(read('deductions'), rowNumber, 'deductions', errors,
    { optional: true, defaultValue: 0, max: MAX_PAYROLL_MONEY });
  const net = parseMoney(read('net'), rowNumber, 'net', errors, { optional: false, max: MAX_PAYROLL_MONEY });
  if (periodStart && periodEnd && periodEnd < periodStart) {
    addError(errors, rowNumber, 'period_end', 'Period end must not be before period start.');
  }
  const employmentId = resolveEmployment(read('employer_name', true), read('job_title', true),
    rowNumber, 'employer_name', errors, context.employments, context.employmentIdAliases);
  const record = { employment_id: employmentId, pay_date: payDate, period_start: periodStart, period_end: periodEnd,
    gross, deductions: deductions ?? PAYROLL_ENTRY_DEFAULTS.deductions, net, notes: nullable(read('notes', true)) };
  try { validatePayrollEntry({ ...PAYROLL_ENTRY_DEFAULTS, ...record }); }
  catch (error) { if (!errors.length) addError(errors, rowNumber, 'net', error.message); }
  return record;
}

function mapApplicationRow(read, rowNumber, errors) {
  const company = read('company', true);
  const position = read('position', true);
  const dateApplied = parseDate(read('date_applied'), rowNumber, 'date_applied', errors, true);
  const status = parseEnum(read('status', true), APPLICATION_STATUSES, rowNumber, 'status', errors, true);
  const source = nullable(read('source', true));
  const jobUrl = nullable(read('job_url', true));
  const location = nullable(read('location', true));
  const contactName = nullable(read('contact_name', true));
  const contactEmail = nullable(read('contact_email', true));
  const notes = nullable(read('notes', true));
  if (!company.trim()) addError(errors, rowNumber, 'company', 'Company is required.');
  if (!position.trim()) addError(errors, rowNumber, 'position', 'Position is required.');
  if (jobUrl && !isHttpUrl(jobUrl)) addError(errors, rowNumber, 'job_url', 'Enter a valid http or https URL.');
  if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) addError(errors, rowNumber, 'contact_email', 'Enter a valid email address.');
  const record = { ...APPLICATION_DEFAULTS, company, position, source, job_url: jobUrl,
    location, date_applied: dateApplied, status, contact_name: contactName, contact_email: contactEmail, notes };
  try { validateApplication(record); }
  catch (error) { if (!errors.length) addError(errors, rowNumber, 'company', error.message); }
  return record;
}

function resolveEmployment(employer, title, row, column, errors, employments, aliases) {
  const employerName = employer.trim();
  const jobTitle = title.trim();
  if (!employerName && !jobTitle) return null;
  if (!employerName) {
    addError(errors, row, column, 'Enter an employer name or leave both job fields blank.');
    return null;
  }
  const matches = employments.filter((job) => textKey(job.employer_name) === textKey(employerName)
    && (!jobTitle || textKey(job.job_title) === textKey(jobTitle)));
  if (!matches.length) {
    addError(errors, row, column, `Job not found: ${employerName}. Import or add your jobs first.`);
    return null;
  }
  if (matches.length > 1) {
    const candidates = matches.map((job) => [job.employer_name, job.job_title, job.start_date].filter(Boolean).join(' — '));
    addError(errors, row, column, `Job reference is ambiguous: ${candidates.join('; ')}.`);
    return null;
  }
  const id = matches[0].id;
  aliases.set(id, id);
  return id;
}

function parseDate(value, row, column, errors, required) {
  const text = value.trim();
  if (!text) {
    if (required) addError(errors, row, column, 'This date is required. Use YYYY-MM-DD.');
    return null;
  }
  if (!isDateOnly(text)) {
    addError(errors, row, column, 'Use YYYY-MM-DD date format (for example 2026-10-15).');
    return null;
  }
  return text;
}

function parseTime(value, row, column, errors) {
  const text = value.trim();
  if (!text) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    addError(errors, row, column, 'Use 24-hour HH:MM time format (for example 22:00).');
    return null;
  }
  return text;
}

function parseMoney(value, row, column, errors, { optional, defaultValue = null, max } = {}) {
  const text = value.trim();
  if (!text) {
    if (!optional) addError(errors, row, column, 'This amount is required. Use plain numbers with up to 2 decimals.');
    return defaultValue;
  }
  if (!MONEY_PATTERN.test(text)) {
    addError(errors, row, column, 'Use a plain number with an optional dot and up to 2 decimals (for example 1234.50).');
    return null;
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) {
    addError(errors, row, column, 'Enter a valid amount of zero or more.');
    return null;
  }
  const cents = Math.round((amount + Number.EPSILON) * 100) / 100;
  if (cents > max) addError(errors, row, column, `Amount must not exceed ${max.toFixed(2)}.`);
  return cents;
}

function parseInteger(value, row, column, errors, defaultValue) {
  const text = value.trim();
  if (!text) return defaultValue;
  if (!/^\d+$/.test(text) || Number(text) > 2_147_483_647) {
    addError(errors, row, column, 'Enter whole minutes of zero or more.');
    return defaultValue;
  }
  return Number(text);
}

function parseBoolean(value, row, column, errors, defaultValue) {
  const text = value.trim().toLocaleLowerCase('en-US');
  if (!text) return defaultValue;
  if (['yes', 'true', '1'].includes(text)) return true;
  if (['no', 'false', '0'].includes(text)) return false;
  addError(errors, row, column, 'Use yes/no, true/false, or 1/0.');
  return defaultValue;
}

function parseEnum(value, allowed, row, column, errors, required) {
  const text = value.trim().toLocaleLowerCase('en-US');
  if (!text && !required) return null;
  const match = allowed.find((item) => item.toLocaleLowerCase('en-US') === text);
  if (match) return match;
  addError(errors, row, column, `Choose one of: ${allowed.join(', ')}.`);
  return required ? allowed[0] : null;
}

function addError(errors, row, column, message) {
  errors.push({ row, column, message });
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

function nullable(value) {
  return value === '' ? null : value;
}

function textKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

function validTimeZone(value) {
  if (typeof value !== 'string' || !value) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0)); return true; }
  catch { return false; }
}

function localTime(timestamp, timeZone) {
  if (!timestamp) return '';
  try { return utcToLocalDateTime(timestamp, timeZone).time; } catch { return ''; }
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function moneyText(value) {
  return value == null || value === '' ? '' : Number(value).toFixed(2);
}

function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
