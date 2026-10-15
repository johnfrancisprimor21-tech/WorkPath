import { estimatePay } from './payroll.js';

const APPLICATION_STATUSES = ['pending', 'interview', 'offer', 'rejected', 'no_response'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Return chronological week buckets (Monday through Sunday), including empty
 * buckets. Each row has startDate, endDate, and workedMinutes.
 */
export function hoursByWeek(shifts, endDate, count) {
  return shiftMinuteBuckets(shifts, endDate, count, 'week', false);
}

/** Return chronological calendar-month worked-minute buckets, including empty months. */
export function hoursByMonth(shifts, endDate, count) {
  return shiftMinuteBuckets(shifts, endDate, count, 'month', false);
}

/** Return chronological Monday-through-Sunday buckets of user-flagged overtime minutes. */
export function overtimeByWeek(shifts, endDate, count) {
  return shiftMinuteBuckets(shifts, endDate, count, 'week', true);
}

/** Return chronological month buckets of user-flagged overtime minutes. */
export function overtimeByMonth(shifts, endDate, count) {
  return shiftMinuteBuckets(shifts, endDate, count, 'month', true);
}

/**
 * Return one row per month with distinct duty dates and dates that had only
 * non-duty days (off, leave, sick, or holiday).
 */
export function dutyDaysByMonth(shifts, endDate, count) {
  const buckets = monthBuckets(endDate, count).map((bucket) => ({
    ...bucket,
    dutyDates: new Set(),
    nonDutyDates: new Set()
  }));
  const byMonth = new Map(buckets.map((bucket) => [bucket.month, bucket]));

  for (const shift of shifts) {
    const bucket = byMonth.get(monthOf(shift.work_date));
    if (!bucket) continue;
    if (shift.day_type === 'duty') bucket.dutyDates.add(shift.work_date);
    else if (['off', 'leave', 'sick', 'holiday'].includes(shift.day_type)) bucket.nonDutyDates.add(shift.work_date);
  }

  return buckets.map(({ month, startDate, endDate: bucketEnd, dutyDates, nonDutyDates }) => ({
    month,
    startDate,
    endDate: bucketEnd,
    dutyDays: dutyDates.size,
    offDays: [...nonDutyDates].filter((date) => !dutyDates.has(date)).length
  }));
}

/**
 * Return monthly logged net receipts and rated-hours estimates in integer
 * cents. netReceivedCents is null when no payday was logged in that month.
 */
export function earningsByMonth({ payrollEntries, shifts, employments, endDate, count }) {
  return monthBuckets(endDate, count).map((bucket) => {
    const entries = payrollEntries.filter((entry) => entry.pay_date >= bucket.startDate && entry.pay_date <= bucket.endDate);
    const estimate = estimatePay({
      shifts,
      employments,
      fromDate: bucket.startDate,
      toDate: bucket.endDate
    });
    return {
      ...bucket,
      netReceivedCents: entries.length
        ? entries.reduce((sum, entry) => sum + moneyToCents(entry.net), 0)
        : null,
      estimatedCents: estimate.totalCents,
      minutesRated: estimate.minutesRated,
      minutesUnrated: estimate.minutesUnrated,
      shiftsUnrated: estimate.shiftsUnrated
    };
  });
}

/** Return minutes and cents by employment, always including a No employer row. */
export function perJob({ shifts, employments, payrollEntries, fromDate, toDate }) {
  const employmentById = new Map(employments.map((employment) => [employment.id, employment]));
  const rows = employments.map((employment) => {
    const jobShifts = shifts.filter((shift) => shift.employment_id === employment.id);
    const estimate = estimatePay({
      shifts: jobShifts,
      employments: [employment],
      fromDate,
      toDate,
      employmentId: employment.id
    });
    return {
      employmentId: employment.id,
      employerName: employment.employer_name,
      jobTitle: employment.job_title || null,
      label: employment.job_title ? `${employment.employer_name} · ${employment.job_title}` : employment.employer_name,
      minutes: sumDutyMinutes(jobShifts, fromDate, toDate),
      estimatedCents: estimate.totalCents,
      netReceivedCents: sumNet(payrollEntries, fromDate, toDate, (entry) => entry.employment_id === employment.id)
    };
  });

  const noEmployerShifts = shifts.filter((shift) => !employmentById.has(shift.employment_id));
  rows.push({
    employmentId: null,
    employerName: 'No employer',
    jobTitle: null,
    label: 'No employer',
    minutes: sumDutyMinutes(noEmployerShifts, fromDate, toDate),
    estimatedCents: 0,
    netReceivedCents: sumNet(payrollEntries, fromDate, toDate, (entry) => !employmentById.has(entry.employment_id))
  });
  return rows;
}

/** Return counts in the same order as the application's status filter chips. */
export function applicationsByStatus(applications) {
  const counts = new Map(APPLICATION_STATUSES.map((status) => [status, 0]));
  for (const application of applications) {
    if (counts.has(application.status)) counts.set(application.status, counts.get(application.status) + 1);
  }
  return APPLICATION_STATUSES.map((status) => ({ status, count: counts.get(status) }));
}

/** Return chronological Monday-through-Sunday application buckets by date_applied. */
export function applicationsByWeek(applications, endDate, count) {
  return applicationBuckets(applications, endDate, count, 'week');
}

/** Return chronological calendar-month application buckets by date_applied. */
export function applicationsByMonth(applications, endDate, count) {
  return applicationBuckets(applications, endDate, count, 'month');
}

/**
 * Treat any status other than the initial pending status as a response.
 * rate is a fraction from 0 to 1, or null until there are at least five rows.
 */
export function responseRate(applications) {
  const total = applications.length;
  const responded = applications.filter((application) => application.status !== 'pending').length;
  return { responded, total, rate: total < 5 ? null : responded / total };
}

/** Inclusive date range spanning count calendar months ending in endDate's month. */
export function monthRange(endDate, count) {
  const [year, month] = dateParts(endDate);
  const size = bucketCount(count);
  if (!size) return { fromDate: null, toDate: null };
  const first = monthParts(year * 12 + month - 1 - size + 1);
  const lastDay = daysInMonth(year, month);
  return {
    fromDate: formatDate(first.year, first.month, 1),
    toDate: formatDate(year, month, lastDay)
  };
}

function shiftMinuteBuckets(shifts, endDate, count, bucketType, overtimeOnly) {
  const buckets = bucketType === 'week' ? weekBuckets(endDate, count) : monthBuckets(endDate, count);
  const indexed = new Map(buckets.map((bucket, index) => [bucket.startDate, index]));
  const values = buckets.map((bucket) => ({ ...bucket, workedMinutes: 0 }));

  for (const shift of shifts) {
    if (!validDateOrNull(shift.work_date) || shift.day_type !== 'duty' || (overtimeOnly && !shift.is_overtime)) continue;
    const key = bucketType === 'week' ? weekStart(shift.work_date) : monthStart(shift.work_date);
    const index = indexed.get(key);
    if (index === undefined) continue;
    values[index].workedMinutes += safeMinutes(shift.worked_minutes);
  }
  return values;
}

function applicationBuckets(applications, endDate, count, bucketType) {
  const buckets = bucketType === 'week' ? weekBuckets(endDate, count) : monthBuckets(endDate, count);
  const indexed = new Map(buckets.map((bucket, index) => [bucket.startDate, index]));
  const values = buckets.map((bucket) => ({ ...bucket, applications: 0 }));
  for (const application of applications) {
    if (!validDateOrNull(application.date_applied)) continue;
    const key = bucketType === 'week' ? weekStart(application.date_applied) : monthStart(application.date_applied);
    const index = indexed.get(key);
    if (index !== undefined) values[index].applications += 1;
  }
  return values;
}

function monthBuckets(endDate, count) {
  const [endYear, endMonth] = dateParts(endDate);
  const size = bucketCount(count);
  const endOrdinal = endYear * 12 + endMonth - 1;
  return Array.from({ length: size }, (_, index) => {
    const { year, month } = monthParts(endOrdinal - size + index + 1);
    return {
      month: formatMonth(year, month),
      startDate: formatDate(year, month, 1),
      endDate: formatDate(year, month, daysInMonth(year, month))
    };
  });
}

function weekBuckets(endDate, count) {
  const size = bucketCount(count);
  const endWeekStart = weekStart(endDate);
  const endWeekStartNumber = dayNumber(endWeekStart);
  return Array.from({ length: size }, (_, index) => {
    const startDay = endWeekStartNumber - (size - index - 1) * 7;
    return {
      startDate: dateFromDayNumber(startDay),
      endDate: dateFromDayNumber(startDay + 6)
    };
  });
}

function sumDutyMinutes(shifts, fromDate, toDate) {
  return shifts.filter((shift) => shift.day_type === 'duty'
    && shift.work_date >= fromDate && shift.work_date <= toDate)
    .reduce((sum, shift) => sum + safeMinutes(shift.worked_minutes), 0);
}

function sumNet(entries, fromDate, toDate, predicate) {
  return entries.filter((entry) => entry.pay_date >= fromDate && entry.pay_date <= toDate && predicate(entry))
    .reduce((sum, entry) => sum + moneyToCents(entry.net), 0);
}

function safeMinutes(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
}

function moneyToCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : 0;
}

function weekStart(date) {
  const number = dayNumber(date);
  const weekday = new Date(number * DAY_MS).getUTCDay();
  return dateFromDayNumber(number - ((weekday + 6) % 7));
}

function monthStart(date) {
  const [year, month] = dateParts(date);
  return formatDate(year, month, 1);
}

function monthOf(date) {
  return monthStart(date).slice(0, 7);
}

function monthParts(ordinal) {
  const year = Math.floor(ordinal / 12);
  return { year, month: ordinal - year * 12 + 1 };
}

function daysInMonth(year, month) {
  const date = utcDate(year, month + 1, 0);
  return date.getUTCDate();
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) throw new RangeError('Enter a valid calendar date.');
  const [year, month, day] = match.slice(1).map(Number);
  const date = utcDate(year, month, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new RangeError('Enter a valid calendar date.');
  }
  return [year, month, day];
}

function validDateOrNull(value) {
  try {
    dateParts(value);
    return true;
  } catch {
    return false;
  }
}

function dayNumber(value) {
  const [year, month, day] = dateParts(value);
  return Math.floor(utcDate(year, month, day).getTime() / DAY_MS);
}

function dateFromDayNumber(number) {
  return new Date(number * DAY_MS).toISOString().slice(0, 10);
}

function utcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year >= 0 && year <= 99) date.setUTCFullYear(year);
  return date;
}

function formatDate(year, month, day) {
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function formatMonth(year, month) {
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0');
}

function bucketCount(count) {
  return Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
}
