const dateTimeFormatters = new Map();

function formatterFor(timeZone) {
  if (!dateTimeFormatters.has(timeZone)) {
    dateTimeFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }));
  }
  return dateTimeFormatters.get(timeZone);
}

function partsAt(instant, timeZone) {
  const values = Object.fromEntries(formatterFor(timeZone)
    .formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function partsAsUtcMilliseconds(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function offsetAt(instantMs, timeZone) {
  const roundedInstant = Math.floor(instantMs / 1000) * 1000;
  return partsAsUtcMilliseconds(partsAt(new Date(roundedInstant), timeZone)) - roundedInstant;
}

function parseDateTime(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (!dateMatch || !timeMatch) throw new Error('Enter a valid local date and time.');
  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month
    || check.getUTCDate() !== parts.day || parts.hour > 23 || parts.minute > 59) {
    throw new Error('Enter a valid local date and time.');
  }
  return parts;
}

export function todayInTimeZone(timeZone, now = new Date()) {
  const parts = partsAt(now, timeZone);
  return formatDateParts(parts);
}

export function currentMonthInTimeZone(timeZone, now = new Date()) {
  return todayInTimeZone(timeZone, now).slice(0, 7);
}

export function addCalendarDay(date) {
  const parts = parseDateTime(date, '12:00');
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return next.toISOString().slice(0, 10);
}

export function localDateTimeToUtc(date, time, timeZone) {
  const wanted = parseDateTime(date, time);
  const naiveMs = partsAsUtcMilliseconds(wanted);
  const offsets = new Set();
  for (const hours of [-48, -36, -24, -12, 0, 12, 24, 36, 48]) {
    offsets.add(offsetAt(naiveMs + hours * 60 * 60 * 1000, timeZone));
  }

  const candidates = [...offsets]
    .map((offset) => naiveMs - offset)
    .filter((instantMs) => sameParts(partsAt(new Date(instantMs), timeZone), wanted))
    .sort((a, b) => a - b);
  if (!candidates.length) {
    throw new Error('That local time does not exist because the clocks change. Choose another time.');
  }
  // In a fall-back overlap, the earlier instant is the first occurrence.
  return new Date(candidates[0]).toISOString();
}

export function utcToLocalDateTime(timestamp, timeZone) {
  const parts = partsAt(new Date(timestamp), timeZone);
  return {
    date: formatDateParts(parts),
    time: String(parts.hour).padStart(2, '0') + ':' + String(parts.minute).padStart(2, '0')
  };
}

export function formatTime(timestamp, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

export function formatDateLabel(date) {
  const parts = parseDateTime(date, '12:00');
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(noonUtc);
}

export function formatShiftDateLabel(date, timeZone) {
  const parts = parseDateTime(date, '12:00');
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).formatToParts(noonUtc).map((part) => [part.type, part.value]));
  return values.month + ' ' + values.day + ', ' + values.year + ' (' + values.weekday + ')';
}

export function formatMonthLabel(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!match) throw new Error('Enter a valid month.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12));
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(date);
}

export function shiftMonth(month, amount) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!match) throw new Error('Enter a valid month.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function sameParts(actual, expected) {
  return actual.year === expected.year && actual.month === expected.month && actual.day === expected.day
    && actual.hour === expected.hour && actual.minute === expected.minute && actual.second === expected.second;
}

function formatDateParts(parts) {
  return String(parts.year).padStart(4, '0') + '-' + String(parts.month).padStart(2, '0') + '-'
    + String(parts.day).padStart(2, '0');
}
