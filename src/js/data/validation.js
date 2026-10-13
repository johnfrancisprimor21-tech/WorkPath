import { DataError } from './errors.js';

const USER_MODES = new Set(['employed', 'job_seeker']);
const PAY_FREQUENCIES = new Set(['weekly', 'biweekly', 'semi_monthly', 'monthly']);
const DAY_TYPES = new Set(['duty', 'off', 'leave', 'sick', 'holiday']);
const APPLICATION_STATUSES = new Set(['pending', 'interview', 'offer', 'rejected', 'no_response']);

export const PROFILE_DEFAULTS = Object.freeze({
  display_name: null,
  mode: 'job_seeker',
  currency: null,
  pay_frequency: null,
  timezone: null,
  onboarded: false
});

export const EMPLOYMENT_DEFAULTS = Object.freeze({
  job_title: null,
  hourly_rate: null,
  start_date: null,
  end_date: null,
  is_current: true
});

export const SHIFT_DEFAULTS = Object.freeze({
  employment_id: null,
  day_type: 'duty',
  time_in: null,
  time_out: null,
  break_minutes: 0,
  is_overtime: false,
  notes: null
});

export const APPLICATION_DEFAULTS = Object.freeze({
  source: null,
  job_url: null,
  location: null,
  status: 'pending',
  contact_name: null,
  contact_email: null,
  notes: null
});

export function validateProfile(profile) {
  if (!USER_MODES.has(profile.mode)) {
    throw new DataError('validation', 'Choose one of the available work modes.');
  }
  if (profile.currency != null && (typeof profile.currency !== 'string' || !/^[A-Z]{3}$/.test(profile.currency))) {
    throw new DataError('validation', 'Choose a valid three-letter currency code.');
  }
  if (profile.pay_frequency != null && !PAY_FREQUENCIES.has(profile.pay_frequency)) {
    throw new DataError('validation', 'Check the required profile details and try again.');
  }
  if (profile.display_name != null && typeof profile.display_name !== 'string') {
    throw new DataError('validation', 'Check the required profile details and try again.');
  }
  if (profile.timezone != null && typeof profile.timezone !== 'string') {
    throw new DataError('validation', 'Check the required profile details and try again.');
  }
  if (typeof profile.onboarded !== 'boolean') {
    throw new DataError('validation', 'Check the required profile details and try again.');
  }
  if (profile.onboarded && (profile.currency == null || profile.timezone == null)) {
    throw new DataError('validation', 'Choose both a currency and a time zone before finishing setup.');
  }
}

export function validateEmployment(employment) {
  if (typeof employment.employer_name !== 'string' || !employment.employer_name.trim()) {
    throw new DataError('validation', 'Employer name is required.');
  }
  if (employment.job_title != null && typeof employment.job_title !== 'string') {
    throw new DataError('validation', 'Check the job details and try again.');
  }
  const rate = employment.hourly_rate;
  if (rate != null && rate !== '') {
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0 || value > 99999999.99) {
      throw new DataError('validation', 'Hourly rate is too large. Enter a smaller amount.');
    }
  }
  if (employment.start_date != null && !isDateOnly(employment.start_date)) {
    throw new DataError('validation', 'Check the job dates and hourly rate, then try again.');
  }
  if (employment.end_date != null && !isDateOnly(employment.end_date)) {
    throw new DataError('validation', 'Check the job dates and hourly rate, then try again.');
  }
  if (employment.start_date && employment.end_date && employment.end_date < employment.start_date) {
    throw new DataError('validation', 'Check the job dates and hourly rate, then try again.');
  }
  if (typeof employment.is_current !== 'boolean') {
    throw new DataError('validation', 'Check the job details and try again.');
  }
}

export function validateShift(shift) {
  if (!isDateOnly(shift.work_date)) {
    throw new DataError('validation', 'Add the required shift details and try again.');
  }
  if (!DAY_TYPES.has(shift.day_type)) {
    throw new DataError('validation', 'Check the shift times, day type, and break length.');
  }
  const breakMinutes = Number(shift.break_minutes);
  if (shift.break_minutes == null || !Number.isInteger(breakMinutes)
      || breakMinutes < 0 || breakMinutes > 2_147_483_647) {
    throw new DataError('validation', 'Check the shift times, day type, and break length.');
  }
  if (typeof shift.is_overtime !== 'boolean') {
    throw new DataError('validation', 'Check the shift times, day type, and break length.');
  }
  for (const time of [shift.time_in, shift.time_out]) {
    if (time != null && !isTimestamp(time)) {
      throw new DataError('validation', 'Check the shift times, day type, and break length.');
    }
  }
  if (shift.time_in && shift.time_out && Date.parse(shift.time_out) <= Date.parse(shift.time_in)) {
    throw new DataError('validation', 'Check the shift times, day type, and break length.');
  }
  if (shift.notes != null && typeof shift.notes !== 'string') {
    throw new DataError('validation', 'Check the shift times, day type, and break length.');
  }
}

export function validateApplication(application) {
  if (typeof application.company !== 'string' || !application.company
      || typeof application.position !== 'string' || !application.position
      || !isDateOnly(application.date_applied)) {
    throw new DataError('validation', 'Company, position, and date applied are required.');
  }
  if (!APPLICATION_STATUSES.has(application.status)) {
    throw new DataError('validation', 'Choose a valid application status.');
  }
}

export function validateApplicationEvent(event) {
  if (!event.application_id || typeof event.event_type !== 'string' || !event.event_type
      || !isTimestamp(event.event_date)) {
    throw new DataError('validation', 'Add the required event details and try again.');
  }
}

export function validateDateRange(fromDate, toDate) {
  if (!isDateOnly(fromDate) || !isDateOnly(toDate) || fromDate > toDate) {
    throw new DataError('validation', 'Choose a valid inclusive date range.');
  }
}

export function normalizeHourlyRate(rate) {
  if (rate == null || rate === '') return null;
  return Math.round(Number(rate) * 100) / 100;
}

export function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value) {
  return (typeof value === 'string' || value instanceof Date)
    && Number.isFinite(Date.parse(value));
}
