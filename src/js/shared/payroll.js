const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Return the pay period containing dateString, using UTC calendar arithmetic.
 * An anchor is the start of a recurring weekly or biweekly period and works in
 * both directions. Biweekly periods require an anchor; unsupported frequencies
 * return null so callers can display a setup message instead of guessing.
 */
export function getPayPeriod(dateString, payFrequency, anchor = null) {
  const targetDay = toDayNumber(dateString);
  if (payFrequency === 'monthly') {
    const [year, month] = dateParts(dateString);
    return { start: dateString.slice(0, 7) + '-01', end: formatDate(year, month, daysInMonth(year, month)) };
  }
  if (payFrequency === 'semi_monthly') {
    const [year, month, day] = dateParts(dateString);
    return day <= 15
      ? { start: formatDate(year, month, 1), end: formatDate(year, month, 15) }
      : { start: formatDate(year, month, 16), end: formatDate(year, month, daysInMonth(year, month)) };
  }
  if (payFrequency === 'weekly' || payFrequency === 'biweekly') {
    const periodDays = payFrequency === 'weekly' ? 7 : 14;
    if (payFrequency === 'biweekly' && !anchor) return null;
    const anchorDay = anchor ? toDayNumber(anchor) : targetDay - ((weekday(targetDay) + 6) % 7);
    const periodStart = anchorDay + Math.floor((targetDay - anchorDay) / periodDays) * periodDays;
    return { start: fromDayNumber(periodStart), end: fromDayNumber(periodStart + periodDays - 1) };
  }
  if (payFrequency == null) return null;
  throw new RangeError('Choose a supported pay frequency.');
}

/** Return the newest non-empty period_start, using payroll list ordering. */
export function findPeriodAnchor(entries) {
  return entries
    .filter((entry) => entry.period_start)
    .slice()
    .sort((a, b) => compareText(b.pay_date, a.pay_date) || compareText(a.id, b.id))[0]
    ?.period_start ?? null;
}

/** Estimate gross pay from rated duty shifts, optionally scoped to one employment; no overtime premium is applied. */
export function estimatePay({ shifts, employments, fromDate, toDate, employmentId = null }) {
  const ratedMinutesByEmployment = new Map();
  const ratesInCents = new Map();
  for (const employment of employments) {
    if (employment.hourly_rate == null || employment.hourly_rate === '') continue;
    const rate = Number(employment.hourly_rate);
    if (!Number.isFinite(rate) || rate < 0) continue;
    ratesInCents.set(employment.id, Math.round((rate + Number.EPSILON) * 100));
  }

  let minutesRated = 0;
  let minutesUnrated = 0;
  let shiftsUnrated = 0;
  for (const shift of shifts) {
    if (employmentId != null && shift.employment_id !== employmentId) continue;
    if (shift.day_type !== 'duty' || shift.work_date < fromDate || shift.work_date > toDate) continue;
    const minutes = Math.max(0, Math.floor(Number(shift.worked_minutes) || 0));
    if (shift.employment_id == null || !ratesInCents.has(shift.employment_id)) {
      minutesUnrated += minutes;
      shiftsUnrated += 1;
      continue;
    }
    minutesRated += minutes;
    ratedMinutesByEmployment.set(shift.employment_id, (ratedMinutesByEmployment.get(shift.employment_id) || 0) + minutes);
  }

  let totalCents = 0;
  for (const [employmentId, minutes] of ratedMinutesByEmployment) {
    totalCents += Math.round(minutes * ratesInCents.get(employmentId) / 60);
  }
  return { totalCents, minutesRated, minutesUnrated, shiftsUnrated };
}

/**
 * Compare gross pay to an estimate. For a zero estimate, minutesRated must be
 * provided and positive so an empty estimate never creates a misleading pill.
 * Returns null when gross or either period date is missing.
 */
export function compareToEstimate(entry, estimateCents, minutesRated = null) {
  if (entry?.gross == null || !entry.period_start || !entry.period_end) return null;
  if (!Number.isFinite(Number(estimateCents)) || !Number.isFinite(Number(entry.gross))) return null;
  const estimate = Math.round(Number(estimateCents));
  if (estimate === 0 && !(Number(minutesRated) > 0)) return null;
  const grossCents = Math.round((Number(entry.gross) + Number.EPSILON) * 100);
  const differenceCents = Math.abs(grossCents - estimate);
  if (differenceCents * 100 <= Math.abs(estimate)) return { status: 'matches', differenceCents };
  return {
    status: grossCents < estimate ? 'below' : 'above',
    differenceCents
  };
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) throw new RangeError('Enter a valid calendar date.');
  const parts = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() + 1 !== parts[1] || date.getUTCDate() !== parts[2]) {
    throw new RangeError('Enter a valid calendar date.');
  }
  return parts;
}

function toDayNumber(value) {
  const [year, month, day] = dateParts(value);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / DAY_MS);
}

function fromDayNumber(dayNumber) {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

function weekday(dayNumber) {
  return new Date(dayNumber * DAY_MS).getUTCDay();
}

function daysInMonth(year, month) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

function formatDate(year, month, day) {
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function compareText(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
}
